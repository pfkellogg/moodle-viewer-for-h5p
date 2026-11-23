<?php
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

namespace local_viewerforh5p;

/**
 * Adds the viewer to the page for the people allowed to see it.
 *
 * @package    local_viewerforh5p
 * @copyright  2026 Patrick Kellogg
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class hook_callbacks {

    /**
     * Before the footer (Moodle 4.4+ hook; lib.php calls this too on older Moodle).
     *
     * @param mixed $hook The hook (unused).
     */
    public static function before_footer($hook = null): void {
        global $PAGE;
        if (!self::allowed()) {
            return;
        }
        // The script finds the H5P on the page (and inside Moodle's H5P frames) by itself, and stays hidden without H5P.
        $PAGE->requires->js(new \moodle_url('/local/viewerforh5p/js/viewer.js', ['v' => get_config('local_viewerforh5p', 'version')]));
    }

    /**
     * Whether the current user may see the viewer here.
     */
    public static function allowed(): bool {
        global $PAGE;
        if (!isloggedin() || isguestuser()) {
            return false;
        }
        try {
            $context = $PAGE->context;
        } catch (\Throwable $e) {
            return false;
        }
        return has_capability('local/viewerforh5p:view', $context);
    }
}
