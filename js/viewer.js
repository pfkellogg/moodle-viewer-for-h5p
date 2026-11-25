// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
// of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License along with Moodle. If not, see
// <https://www.gnu.org/licenses/>.

/* global H5PIntegration */
/**
 * Viewer for H5P (Moodle): lists every question and answer in the H5P on the page, the right ones marked, for the
 * people allowed to see it (capability local/viewerforh5p:view). It reads only what H5P already sends to the browser.
 *
 * @copyright  2026 Patrick Kellogg
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
;(function addStyles() {
  // Loaded from the page footer, after Moodle wrote the page head: the stylesheet comes in here, next to this script.
  var me = document.currentScript && document.currentScript.src
  if (!me || document.getElementById('local-viewerforh5p-css')) return
  var link = document.createElement('link')
  link.id = 'local-viewerforh5p-css'
  link.rel = 'stylesheet'
  link.href = me.replace(/\/js\/viewer\.js(\?.*)?$/, '/css/viewer.css$1')
  document.head.appendChild(link)
})()

/* Viewer for H5P (Moodle). */
;(function () {
  'use strict'

  // ─── Utilities ────────────────────────────────────────────────────────────

  function safeJson(str) {
    if (!str) return null
    if (typeof str === 'object') return str
    try {
      return JSON.parse(str)
    } catch (e) {
      return null
    }
  }

  function machineName(library) {
    // library may be "H5P.MultiChoice 1.16" or just "H5P.MultiChoice"
    return (library || '').split(' ')[0]
  }

  function stripHtml(html) {
    // DOMParser makes an inert document: no scripts run and no images load (a div's innerHTML would load them).
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    return doc.body ? doc.body.textContent || '' : ''
  }

  // ─── Image helpers ────────────────────────────────────────────────────────

  // Current content ID — set per-content during extraction.
  var _currentContentId = null
  var _currentContentUrl = ''

  function resolveH5PPath(path) {
    if (!path) return null
    if (path.indexOf('http') === 0) return path
    var clean = path.replace(/\\\//g, '/')
    // Moodle gives each item's folder (contentUrl, e.g. /pluginfile.php/1/core_h5p/content/1).
    if (_currentContentUrl) return _currentContentUrl.replace(/\/$/, '') + '/' + clean
    return ''
  }

  function getElementImage(el) {
    if (!el || !el.type || !el.type.params) return null
    var lib = (el.type.library || '').split(' ')[0]
    if (lib === 'H5P.Image' && el.type.params.file && el.type.params.file.path) {
      return resolveH5PPath(el.type.params.file.path)
    }
    return null
  }

  function getMediaImage(params) {
    if (!params || !params.media || !params.media.type || !params.media.type.params) return null
    var lib = (params.media.type.library || '').split(' ')[0]
    if (lib === 'H5P.Image' && params.media.type.params.file && params.media.type.params.file.path) {
      return resolveH5PPath(params.media.type.params.file.path)
    }
    return null
  }

  // ─── Per-type question extractors ─────────────────────────────────────────
  // Each extractor receives (params, location) and returns an array of:
  //   { location, question, answers: [{text, correct, image}], type, media }

  var extractors = {}

  // H5P.MultiChoice
  extractors['H5P.MultiChoice'] = function (params, loc) {
    var q = stripHtml(params.question || '')
    var media = getMediaImage(params)
    var answers = (params.answers || []).map(function (a) {
      return { text: stripHtml(a.text || ''), correct: !!a.correct }
    })
    return [{ location: loc, question: q, answers: answers, type: 'Multiple Choice', media: media }]
  }

  // H5P.TrueFalse
  extractors['H5P.TrueFalse'] = function (params, loc) {
    var q = stripHtml(params.question || '')
    var correct = params.correct === 'true' ? 'True' : 'False'
    return [
      {
        location: loc,
        question: q,
        type: 'True / False',
        answers: [
          { text: 'True', correct: params.correct === 'true' },
          { text: 'False', correct: params.correct === 'false' }
        ]
      }
    ]
  }

  // H5P.Blanks (Fill in the Blanks)
  extractors['H5P.Blanks'] = function (params, loc) {
    return (params.questions || []).map(function (rawQ, idx) {
      var text = stripHtml(rawQ || '')
      // correct answers are the *value* inside *...*
      var answers = []
      var re = /\*([^*]+)\*/g,
        m
      while ((m = re.exec(rawQ)) !== null) {
        // multiple accepted: slash-separated
        m[1].split('/').forEach(function (a) {
          answers.push({ text: a.trim(), correct: true })
        })
      }
      return {
        location: loc + ' › Gap ' + (idx + 1),
        question: text.replace(/\*[^*]+\*/g, '_____'),
        answers: answers,
        type: 'Fill in the Blanks'
      }
    })
  }

  // H5P.SingleChoiceSet
  extractors['H5P.SingleChoiceSet'] = function (params, loc) {
    return (params.choices || []).map(function (choice, idx) {
      var q = stripHtml(choice.question || '')
      var answers = (choice.answers || []).map(function (a, ai) {
        return { text: stripHtml(a || ''), correct: ai === 0 } // first is always correct
      })
      return { location: loc + ' › Question ' + (idx + 1), question: q, answers: answers, type: 'Single Choice Set' }
    })
  }

  // H5P.DragQuestion
  extractors['H5P.DragQuestion'] = function (params, loc) {
    var taskDesc = stripHtml(params.taskDescription || '')
    var task = (params.question && params.question.task) || {}
    var elements = task.elements || []
    var items = []

    ;(task.dropZones || []).forEach(function (dz, di) {
      var dzLabel = stripHtml(dz.label || 'Drop Zone ' + (di + 1))
      var answers = (dz.correctElements || []).map(function (elId) {
        var el = elements[parseInt(elId, 10)]
        var text = el && el.type && el.type.params ? stripHtml(el.type.params.text || el.type.params.alt || String(elId)) : String(elId)
        var image = getElementImage(el)
        return { text: text, correct: true, image: image }
      })

      // Also list the draggables that do NOT belong here as wrong options
      elements.forEach(function (el, ei) {
        var alreadyCorrect = (dz.correctElements || []).indexOf(String(ei)) !== -1
        if (!alreadyCorrect) {
          var text = el.type && el.type.params ? stripHtml(el.type.params.text || el.type.params.alt || 'Item ' + (ei + 1)) : 'Item ' + (ei + 1)
          var image = getElementImage(el)
          answers.push({ text: text, correct: false, image: image })
        }
      })

      items.push({
        location: loc + ' › Drop Zone ' + (di + 1),
        question: taskDesc ? taskDesc + ' — ' + dzLabel : dzLabel,
        answers: answers,
        type: 'Drag and Drop'
      })
    })
    return items
  }

  // H5P.MarkTheWords
  extractors['H5P.MarkTheWords'] = function (params, loc) {
    var text = stripHtml(params.taskDescription || '')
    var body = params.textField || ''
    var words = []
    var re = /\*([^*]+)\*/g,
      m
    while ((m = re.exec(body)) !== null) {
      words.push({ text: m[1], correct: true })
    }
    return [
      {
        location: loc,
        question: text,
        answers: words.length ? words : [{ text: 'See marked text', correct: true }],
        type: 'Mark the Words'
      }
    ]
  }

  // H5P.Summary
  extractors['H5P.Summary'] = function (params, loc) {
    var intro = stripHtml(params.intro || 'Choose the correct statement')
    return (params.summaries || []).map(function (s, idx) {
      var answers = (s.summary || []).map(function (stmt, si) {
        return { text: stripHtml(stmt || ''), correct: si === 0 } // index 0 is always the correct statement
      })
      return {
        location: loc + ' › Part ' + (idx + 1),
        question: intro,
        answers: answers,
        type: 'Summary'
      }
    })
  }

  // H5P.Flashcards
  extractors['H5P.Flashcards'] = function (params, loc) {
    return (params.cards || []).map(function (card, idx) {
      return {
        location: loc + ' › Card ' + (idx + 1),
        question: stripHtml(card.text || ''),
        answers: [{ text: stripHtml(card.answer || ''), correct: true }],
        type: 'Flashcards'
      }
    })
  }

  // H5P.ImageHotspotQuestion
  extractors['H5P.ImageHotspotQuestion'] = function (params, loc) {
    var q = stripHtml(((params.taskDescription || {}).params && params.taskDescription.params.text) || 'Click on the correct hotspot')
    var hs = params.imageHotspotQuestion || {}
    return [
      {
        location: loc,
        question: q,
        answers: [{ text: 'Hotspot ' + ((hs.hotspot || {}).i || 1) + ' is correct', correct: true }],
        type: 'Image Hotspot'
      }
    ]
  }

  // ─── Container / composite type parsers ───────────────────────────────────

  /**
   * Recursively extract all questions from any H5P params object.
   * `library`  – machine name string e.g. "H5P.MultiChoice"
   * `params`   – parsed JSON params for that library
   * `location` – human-readable path, e.g. "Slide 2 › Element 3"
   */
  // Content types that are purely presentational — never shown in the inspector
  var SKIP_TYPES = {
    'H5P.Text': true,
    'H5P.AdvancedText': true,
    'H5P.Image': true,
    'H5P.Video': true,
    'H5P.Audio': true,
    'H5P.Table': true,
    'H5P.Link': true,
    'H5P.DocumentationTool': true
  }

  function extractAll(library, params, location) {
    var mn = machineName(library)
    var results = []

    // Skip purely presentational types
    if (SKIP_TYPES[mn]) return results

    // Direct extractor match
    if (extractors[mn]) {
      return extractors[mn](params, location)
    }

    // ── H5P.QuestionSet ───────────────────────────────────────────────────
    if (mn === 'H5P.QuestionSet') {
      ;(params.questions || []).forEach(function (q, idx) {
        var childLib = q.library || ''
        var childParams = safeJson(q.params) || q.params || {}
        var loc = location + ' › Question ' + (idx + 1)
        results = results.concat(extractAll(childLib, childParams, loc))
      })
      return results
    }

    // ── H5P.CoursePresentation ────────────────────────────────────────────
    if (mn === 'H5P.CoursePresentation') {
      var slides = (params.presentation && params.presentation.slides) || params.slides || []
      slides.forEach(function (slide, si) {
        var slideLoc = location + ' › Slide ' + (si + 1)
        ;(slide.elements || []).forEach(function (el, ei) {
          if (!el.action) return
          var elLib = el.action.library || ''
          var elParams = safeJson(el.action.params) || el.action.params || {}
          var elLoc = slideLoc + ' › Element ' + (ei + 1)
          results = results.concat(extractAll(elLib, elParams, elLoc))
        })
      })
      return results
    }

    // ── H5P.InteractiveVideo ──────────────────────────────────────────────
    if (mn === 'H5P.InteractiveVideo') {
      var ivAssets = (params.interactiveVideo && params.interactiveVideo.assets) || {}
      var interactions = (ivAssets.interactions || []).concat(params.interactionsWithoutPauses || []).concat(params.interactions || [])
      interactions.forEach(function (ia, ii) {
        if (!ia.action) return
        var iaLib = ia.action.library || ''
        var iaParams = safeJson(ia.action.params) || ia.action.params || {}
        var time = ia.duration ? ia.duration.from : ii
        var iaLoc = location + ' › Interaction @ ' + formatTime(time)
        var subCid = ia.action.subContentId || null
        var extracted = extractAll(iaLib, iaParams, iaLoc)
        if (extracted.length) {
          extracted.forEach(function (e) {
            e.timestamp = time
            e.subContentId = subCid
          })
          results = results.concat(extracted)
        } else if (!SKIP_TYPES[machineName(iaLib)]) {
          // Unknown/non-question type — include as a step so it shows as a dot
          var label = iaParams.contentName || iaParams.title || iaParams.alt || ''
          results.push({
            location: iaLoc,
            question: label ? stripHtml(label) : machineName(iaLib),
            answers: [],
            type: machineName(iaLib),
            isQuestion: false,
            timestamp: time,
            subContentId: subCid
          })
        }
      })
      results.sort(function (a, b) {
        return (a.timestamp || 0) - (b.timestamp || 0)
      })

      // ── IV end-of-video summary task ─────────────────────────────────────
      // Stored at interactiveVideo.summary.task, NOT inside assets
      var ivSummaryBlock = params.interactiveVideo && params.interactiveVideo.summary
      var ivSummary = ivSummaryBlock && ivSummaryBlock.task
      if (ivSummary && ivSummary.library) {
        var sLib    = ivSummary.library || ''
        var sParams = safeJson(ivSummary.params) || ivSummary.params || {}
        var sCid    = ivSummary.subContentId || null
        var sExtracted = extractAll(sLib, sParams, location + ' › End Summary')
        sExtracted.forEach(function (e) {
          e.timestamp   = Infinity
          e.subContentId = sCid
        })
        results = results.concat(sExtracted)
      }

      return results
    }

    // ── H5P.Column ────────────────────────────────────────────────────────
    if (mn === 'H5P.Column') {
      ;(params.content || []).forEach(function (item, idx) {
        if (!item.content) return
        var cLib = item.content.library || ''
        var cParams = safeJson(item.content.params) || item.content.params || {}
        var cLoc = location + ' › Item ' + (idx + 1)
        results = results.concat(extractAll(cLib, cParams, cLoc))
      })
      return results
    }

    // ── H5P.BranchingScenario ─────────────────────────────────────────────
    if (mn === 'H5P.BranchingScenario') {
      ;((params.branchingScenario && params.branchingScenario.content) || []).forEach(function (node, idx) {
        if (!node.type) return
        var nLib = node.type.library || ''
        var nParams = safeJson(node.type.params) || node.type.params || {}
        var nLoc = location + ' › Node ' + (idx + 1)
        results = results.concat(extractAll(nLib, nParams, nLoc))
      })
      return results
    }

    // ── H5P.Accordion ─────────────────────────────────────────────────────
    if (mn === 'H5P.Accordion') {
      ;(params.panels || []).forEach(function (panel, idx) {
        if (!panel.content || !panel.content.library) return
        var pLib = panel.content.library || ''
        var pParams = safeJson(panel.content.params) || panel.content.params || {}
        var pLoc = location + ' › Panel "' + stripHtml(panel.title || idx + 1) + '"'
        results = results.concat(extractAll(pLib, pParams, pLoc))
      })
      return results
    }

    return results
  }

  function formatTime(secs) {
    secs = Math.round(secs || 0)
    var m = Math.floor(secs / 60)
    var s = secs % 60
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
  }

  // ─── Fetch DB metadata then build UI ──────────────────────────────────────

  /**
   * Moodle version: no REST metadata fetch needed.
   * All data comes from H5PIntegration.contents which is already parsed.
   */
  function fetchMetadata(ids, cb) {
    // In Moodle, we don't have a separate metadata endpoint.
    // Return empty array — the parsedMap data from H5PIntegration is sufficient.
    cb([])
  }

  // ─── xAPI coverage map ───────────────────────────────────────────────────

  var XAPI_COVERAGE = {
    'H5P.MultiChoice':          { verbs: ['answered','completed'], interactionType: 'choice',    scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.TrueFalse':            { verbs: ['answered','completed'], interactionType: 'true-false', scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.Blanks':               { verbs: ['answered','completed'], interactionType: 'fill-in',   scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.SingleChoiceSet':      { verbs: ['answered','completed'], interactionType: 'choice',    scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.DragQuestion':         { verbs: ['answered','completed'], interactionType: 'matching',  scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.MarkTheWords':         { verbs: ['answered','completed'], interactionType: 'choice',    scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.Summary':              { verbs: ['answered','completed'], interactionType: 'choice',    scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.Flashcards':           { verbs: ['answered','completed'], interactionType: 'fill-in',   scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.ImageHotspotQuestion': { verbs: ['answered','completed'], interactionType: 'other',     scoring: true,  completion: true,  activityType: 'cmi.interaction' },
    'H5P.QuestionSet':          { verbs: ['answered','completed','passed','failed'], interactionType: 'compound', scoring: true,  completion: true,  activityType: 'assessment' },
    'H5P.InteractiveVideo':     { verbs: ['answered','completed','experienced','interacted'],     interactionType: 'compound', scoring: true,  completion: true,  activityType: 'media' },
    'H5P.CoursePresentation':   { verbs: ['answered','completed','experienced'],                  interactionType: 'compound', scoring: true,  completion: true,  activityType: 'assessment' },
    'H5P.Column':               { verbs: ['completed','experienced'],                             interactionType: 'compound', scoring: false, completion: true,  activityType: 'module' },
    'H5P.BranchingScenario':    { verbs: ['answered','completed','experienced'],                  interactionType: 'compound', scoring: true,  completion: true,  activityType: 'simulation' },
    'H5P.Accordion':            { verbs: ['experienced'],                                         interactionType: null,       scoring: false, completion: false, activityType: 'module' }
  }

  function buildXapiSection(mn) {
    var cov = XAPI_COVERAGE[mn]
    if (!cov) return null

    var wrap = el('div', 'h5p-viewer-xapi')

    var title = el('div', 'h5p-viewer-xapi-title')
    title.innerHTML = 'xAPI Coverage <span class="h5p-viewer-xapi-arrow">▶</span>'

    var body = el('div', 'h5p-viewer-xapi-body')
    body.style.display = 'none'

    title.addEventListener('click', function () {
      var open = body.style.display !== 'none'
      body.style.display = open ? 'none' : ''
      title.querySelector('.h5p-viewer-xapi-arrow').textContent = open ? '▶' : '▼'
    })

    wrap.appendChild(title)

    var rows = [
      { label: 'Verbs',            value: cov.verbs.join(' · ') },
      { label: 'Interaction Type', value: cov.interactionType || '—' },
      { label: 'Scoring',          value: cov.scoring    ? '✓ Yes' : '✗ No' },
      { label: 'Completion',       value: cov.completion ? '✓ Yes' : '✗ No' },
      { label: 'Activity Type',    value: cov.activityType }
    ]

    rows.forEach(function (r) {
      var row = el('div', 'h5p-viewer-xapi-row')
      row.innerHTML = '<span class="h5p-viewer-label">' + esc(r.label) + ':</span> <span class="h5p-viewer-xapi-value">' + esc(r.value) + '</span>'
      body.appendChild(row)
    })

    wrap.appendChild(body)
    return wrap
  }

  // ─── UI Builder ──────────────────────────────────────────────────────────

  var _qIdCounter = 0

  function buildPanel(allData) {
    if (!allData || !allData.length) return
    var root = document.getElementById('h5p-viewer-root')
    if (!root) {
      // The viewer's own container, at the end of the page.
      root = document.createElement('div')
      root.id = 'h5p-viewer-root'
      document.body.appendChild(root)
    }
    root.innerHTML = ''
    root.setAttribute('aria-hidden', 'false')

    // Toggle button
    var toggle = document.createElement('button')
    toggle.id = 'h5p-viewer-toggle'
    toggle.className = 'h5p-viewer-toggle'
    toggle.title = 'Viewer for H5P'
    toggle.innerHTML = '<span class="h5p-viewer-toggle-icon">H5P</span><span class="h5p-viewer-toggle-badge">' + allData.length + '</span>'
    root.appendChild(toggle)

    // Panel
    var panel = document.createElement('div')
    panel.id = 'h5p-viewer-panel'
    panel.className = 'h5p-viewer-panel h5p-viewer-panel--closed'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Viewer for H5P')
    root.appendChild(panel)

    // Header
    var header = el('div', 'h5p-viewer-header')
    header.innerHTML = '<span class="h5p-viewer-title">Viewer for H5P</span>'
    var closeBtn = el('button', 'h5p-viewer-close')
    closeBtn.innerHTML = '&times;'
    closeBtn.title = 'Close'
    header.appendChild(closeBtn)
    panel.appendChild(header)

    // Body
    var body = el('div', 'h5p-viewer-body')
    panel.appendChild(body)

    _qIdCounter = 0

    if (!allData.length) {
      body.innerHTML = '<p class="h5p-viewer-empty">No H5P content found on this page.</p>'
    } else if (allData.length === 1) {
      body.appendChild(buildContentBlock(allData[0]))
    } else {
      // Multiple H5Ps — one tab per item
      var tabBar = el('div', 'h5p-viewer-tabs')
      var contentPanels = []

      allData.forEach(function (item, idx) {
        var tab = el('button', 'h5p-viewer-tab')
        if (idx === 0) tab.classList.add('h5p-viewer-tab--active')
        var shortName = item.title ||
          ((item.machine_name ? item.machine_name.replace('H5P.', '') : 'H5P') +
           (item.id ? ' #' + item.id : ''))
        tab.textContent = shortName
        tab.title = shortName
        tab.setAttribute('data-tab-index', String(idx))
        tabBar.appendChild(tab)

        var contentBlock = buildContentBlock(item)
        if (idx !== 0) contentBlock.style.display = 'none'
        contentPanels.push(contentBlock)
        body.appendChild(contentBlock)
      })

      tabBar.addEventListener('click', function (e) {
        var btn = e.target.closest('.h5p-viewer-tab')
        if (!btn) return
        var targetIdx = parseInt(btn.getAttribute('data-tab-index'), 10)
        if (isNaN(targetIdx)) return
        tabBar.querySelectorAll('.h5p-viewer-tab').forEach(function (t, i) {
          t.classList.toggle('h5p-viewer-tab--active', i === targetIdx)
        })
        contentPanels.forEach(function (p, i) {
          p.style.display = i === targetIdx ? '' : 'none'
        })
      })

      panel.insertBefore(tabBar, body)
    }

    // Resize handle
    var resizeHandle = el('div', 'h5p-viewer-resize')
    panel.appendChild(resizeHandle)

    // Events
    toggle.addEventListener('click', function () {
      var closed = panel.classList.contains('h5p-viewer-panel--closed')
      panel.classList.toggle('h5p-viewer-panel--closed', !closed)
      toggle.classList.toggle('h5p-viewer-toggle--active', closed)
    })
    closeBtn.addEventListener('click', function () {
      panel.classList.add('h5p-viewer-panel--closed')
      toggle.classList.remove('h5p-viewer-toggle--active')
    })

    // Drag to move
    header.addEventListener('mousedown', function (e) {
      if (e.target === closeBtn) return
      var rect = panel.getBoundingClientRect()
      var startX = e.clientX,
        startY = e.clientY
      var origLeft = rect.left,
        origTop = rect.top
      panel.style.transition = 'none'
      panel.style.right = 'auto'
      panel.style.left = origLeft + 'px'
      panel.style.top = origTop + 'px'

      function onMove(e) {
        panel.style.left = origLeft + e.clientX - startX + 'px'
        panel.style.top = origTop + e.clientY - startY + 'px'
      }
      function onUp() {
        panel.style.transition = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      e.preventDefault()
    })

    // Drag to resize
    resizeHandle.addEventListener('mousedown', function (e) {
      var rect = panel.getBoundingClientRect()
      var startX = e.clientX,
        startY = e.clientY
      var origW = rect.width,
        origH = rect.height
      panel.style.transition = 'none'

      function onMove(e) {
        panel.style.width = Math.max(280, origW + e.clientX - startX) + 'px'
        panel.style.height = Math.max(160, origH + e.clientY - startY) + 'px'
      }
      function onUp() {
        panel.style.transition = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      e.preventDefault()
    })
  }

  function buildContentBlock(item) {
    var block = el('section', 'h5p-viewer-content')

    // ── Content header ────────────────────────────────────────────────────
    var ch = el('div', 'h5p-viewer-content-header')
    var badge = el('span', 'h5p-viewer-badge')
    badge.innerHTML = '<span class="h5p-viewer-label">Type:</span> ' + esc(item.library || item.machine_name || 'H5P')
    ch.appendChild(badge)

    var titleWrap = el('span', 'h5p-viewer-content-title')
    titleWrap.innerHTML = '<span class="h5p-viewer-label">Title:</span> ' + esc(item.title || '(untitled)')
    ch.appendChild(titleWrap)

    if (item.id) {
      var idSpan = el('span', 'h5p-viewer-content-id')
      idSpan.innerHTML = '<span class="h5p-viewer-label">ID:</span> ' + esc(String(item.id))
      ch.appendChild(idSpan)
    }
    block.appendChild(ch)

    // ── Secure H5P badge or question count ───────────────────────────────
    if (item.dvpSecured) {
      var secBadge = el('div', 'h5p-viewer-secured-badge')
      secBadge.innerHTML = '<span class="h5p-viewer-secured-icon">&#x1F6E1;</span> Secured by Secure Answers for H5P: the answers are on the server, not in the browser'
      block.appendChild(secBadge)
    } else if (item.questions && item.questions.length) {
      var qCount = el('div', 'h5p-viewer-question-count')
      qCount.innerHTML = '<span class="h5p-viewer-exposed-icon">&#x26A0;</span> ' + item.questions.length + ' question' + (item.questions.length !== 1 ? 's' : '') + ' with answers exposed in the browser'
      block.appendChild(qCount)
    }

    // ── Where used ───────────────────────────────────────────────────────
    if (item.usages && item.usages.length) {
      var usageWrap = el('div', 'h5p-viewer-usages')
      var usageLabel = el('span', 'h5p-viewer-label')
      usageLabel.textContent = 'Found in:'
      usageWrap.appendChild(usageLabel)
      item.usages.forEach(function (u) {
        var usageLine = el('div', 'h5p-viewer-usage-line')
        var link = document.createElement('a')
        link.href = u.view_url || '#'
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = u.post_title + ' (' + u.post_type + ')'
        usageLine.appendChild(link)
        if (u.edit_url) {
          var editLink = document.createElement('a')
          editLink.href = u.edit_url
          editLink.target = '_blank'
          editLink.rel = 'noopener'
          editLink.className = 'h5p-viewer-edit-link'
          editLink.textContent = 'Edit'
          usageLine.appendChild(editLink)
        }
        usageWrap.appendChild(usageLine)
      })
      block.appendChild(usageWrap)
    }

    // ── xAPI coverage ────────────────────────────────────────────────────
    var xapiSection = buildXapiSection(item.machine_name || machineName(item.library || ''))
    if (xapiSection) block.appendChild(xapiSection)

    // ── Questions ─────────────────────────────────────────────────────────
    if (item.questions && item.questions.length) {
      var qSection = el('div', 'h5p-viewer-questions')
      item.questions.forEach(function (q, qi) {
        qSection.appendChild(buildQuestionBlock(q, qi))
      })
      block.appendChild(qSection)
    } else {
      var noQ = el('p', 'h5p-viewer-empty')
      if (item.dvpSecured) {
        noQ.textContent = 'Questions and answers are secured on the server. Nothing to extract from the browser.'
      } else if (item.childCount) {
        var childUnit =
          {
            'H5P.InteractiveVideo': 'interaction',
            'H5P.QuestionSet': 'question',
            'H5P.CoursePresentation': 'slide',
            'H5P.Column': 'item',
            'H5P.BranchingScenario': 'node'
          }[item.machine_name] || 'step'
        noQ.textContent = 'This content contains ' + item.childCount + ' ' + childUnit + (item.childCount !== 1 ? 's' : '') + '.'
      } else {
        noQ.textContent = 'No extractable questions / answers found for this content type.'
      }
      block.appendChild(noQ)
    }

    return block
  }

  function buildQuestionBlock(q, qi) {
    var qBlock = el('div', 'h5p-viewer-question')
    qBlock.id = 'h5p-insp-q-' + _qIdCounter++
    qBlock.setAttribute('data-question-text', q.question || '')

    if (q.timestamp != null) {
      var locEl = el('div', 'h5p-viewer-location')
      var locValue = q.timestamp === Infinity ? 'End' : formatTime(q.timestamp)
      locEl.innerHTML = '<span class="h5p-viewer-label">Time:</span> ' + esc(locValue)
      qBlock.appendChild(locEl)
    }

    var typeEl = el('div', 'h5p-viewer-type')
    typeEl.innerHTML = '<span class="h5p-viewer-label">Type:</span> ' + esc(q.type || '—')
    qBlock.appendChild(typeEl)


    // Media image (e.g. berry image on MultiChoice)
    if (q.media) {
      var mediaEl = el('div', 'h5p-viewer-media')
      var mediaImg = document.createElement('img')
      mediaImg.src = q.media
      mediaImg.className = 'h5p-viewer-media-img'
      mediaImg.style.maxWidth = '120px'
      mediaImg.style.borderRadius = '6px'
      mediaImg.style.margin = '4px 0 8px'
      mediaEl.appendChild(mediaImg)
      qBlock.appendChild(mediaEl)
    }

    var qText = el('div', 'h5p-viewer-question-text')
    qText.innerHTML = '<span class="h5p-viewer-label">Question:</span> ' + esc(q.question || '—')
    qBlock.appendChild(qText)

    if (q.answers && q.answers.length) {
      var aList = el('ul', 'h5p-viewer-answers')
      q.answers.forEach(function (a) {
        var li = document.createElement('li')
        li.className = 'h5p-viewer-answer' + (a.correct ? ' h5p-viewer-answer--correct' : '')
        var marker = a.correct ? '<span class="h5p-viewer-correct-marker" title="Correct">&#10003;</span> ' : '<span class="h5p-viewer-wrong-marker" title="Incorrect">&#10005;</span> '

        if (a.image) {
          // Render image element instead of text
          li.innerHTML = marker
          var ansImg = document.createElement('img')
          ansImg.src = a.image
          ansImg.alt = a.text || ''
          ansImg.title = a.text || ''
          ansImg.className = 'h5p-viewer-answer-img'
          ansImg.style.maxWidth = '60px'
          ansImg.style.maxHeight = '60px'
          ansImg.style.borderRadius = '4px'
          ansImg.style.verticalAlign = 'middle'
          ansImg.style.marginRight = '6px'
          li.appendChild(ansImg)
          if (a.text) {
            var textSpan = document.createElement('span')
            textSpan.textContent = a.text
            textSpan.style.verticalAlign = 'middle'
            li.appendChild(textSpan)
          }
        } else {
          li.innerHTML = marker + esc(a.text || '(no text)')
        }

        aList.appendChild(li)
      })
      qBlock.appendChild(aList)
    }

    return qBlock
  }

  function el(tag, cls) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    return e
  }

  function esc(str) {
    var d = document.createElement('div')
    d.textContent = str
    return d.innerHTML
  }

  // ─── Main ─────────────────────────────────────────────────────────────────

  function init(contents) {
    var ids = []
    var parsedMap = {} // id → { questions }

    Object.keys(contents).forEach(function (cid) {
      // cid is like "cid-42"
      var id = parseInt(cid.replace('cid-', ''), 10)
      if (!isNaN(id)) ids.push(id)

      var c = contents[cid]
      _currentContentId = id
      _currentContentUrl = (contents[cid] && contents[cid].contentUrl) || ''
      var library = c.library || ''
      var params = safeJson(c.jsonContent)
      var topLoc = 'Root'
      var cTitle = c.title || (params && params.metadata && params.metadata.title) || ''

      var mn = machineName(library)
      var childCount = 0
      if (params) {
        if (mn === 'H5P.InteractiveVideo') {
          var ivA = (params.interactiveVideo && params.interactiveVideo.assets) || {}
          childCount = (ivA.interactions || [])
            .concat(params.interactionsWithoutPauses || [])
            .concat(params.interactions || [])
            .filter(function (ia) {
              return !!ia.action
            }).length + (params.interactiveVideo && params.interactiveVideo.summary && params.interactiveVideo.summary.task ? 1 : 0)
        } else if (mn === 'H5P.QuestionSet') {
          childCount = (params.questions || []).length
        } else if (mn === 'H5P.CoursePresentation') {
          childCount = ((params.presentation && params.presentation.slides) || params.slides || []).length
        } else if (mn === 'H5P.Column') {
          childCount = (params.content || []).length
        } else if (mn === 'H5P.BranchingScenario') {
          childCount = ((params.branchingScenario && params.branchingScenario.content) || []).length
        }
      }

      parsedMap[id] = {
        title: cTitle,
        library: library,
        machine_name: mn,
        questions: params ? extractAll(library, params, topLoc) : [],
        childCount: childCount,
        dvpSecured: !!c.dvpSecured
      }
    })

    fetchMetadata(ids, function (dbItems) {
      var allData = ids.map(function (id) {
        var db =
          dbItems.find(function (d) {
            return d.id === id
          }) || {}
        var parsed = parsedMap[id] || {}
        return Object.assign({}, db, {
          id: id,
          title: db.title || parsed.title,
          library: db.library || parsed.library,
          machine_name: db.machine_name || parsed.machine_name,
          questions: parsed.questions || [],
          childCount: parsed.childCount || 0,
          dvpSecured: !!parsed.dvpSecured
        })
      })
      buildPanel(
        allData.filter(function (item) {
          return !SKIP_TYPES[item.machine_name || machineName(item.library || '')]
        })
      )
    })
  }

  // ─── Start ───────────────────────────────────────────────────────────────
  // Moodle shows H5P inside a frame (/h5p/embed.php), and H5PIntegration (with every answer) lives in that frame.
  // The panel goes on the page around it: it reads H5PIntegration from the page itself and from every same-site
  // frame on it. Inside the H5P frame itself it does nothing.

  function insideH5PFrame() {
    try {
      return window.self !== window.top && /\/h5p\/embed\.php$/.test(window.location.pathname)
    } catch (e) {
      return true
    }
  }

  function gatherContents() {
    var all = {}
    var add = function (w) {
      try {
        var integ = w.H5PIntegration
        if (integ && integ.contents) {
          Object.keys(integ.contents).forEach(function (k) {
            all[k] = integ.contents[k]
          })
        }
      } catch (e) {
        // a frame from another site: not readable, and not H5P from this Moodle
      }
    }
    add(window)
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (f) {
      try {
        if (f.contentWindow) add(f.contentWindow)
      } catch (e) {}
    })
    return all
  }

  function start() {
    if (insideH5PFrame()) return
    // The H5P frames load after the page: look until the count stops changing (or 20 s pass).
    var last = -1
    var steady = 0
    var tries = 0
    ;(function look() {
      var contents = gatherContents()
      var n = Object.keys(contents).length
      steady = n > 0 && n === last ? steady + 1 : 0
      last = n
      if (steady >= 2) {
        init(contents)
        return
      }
      if (++tries < 40) setTimeout(look, 500)
      else if (n > 0) init(contents)
    })()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
