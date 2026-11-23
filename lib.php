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

/**
 * Library: the viewer on Moodle before 4.4 (later versions use db/hooks.php).
 *
 * @package    local_viewerforh5p
 * @copyright  2026 Patrick Kellogg
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Legacy footer callback (Moodle 4.1 to 4.3).
 *
 * @return string
 */
function local_viewerforh5p_before_footer() {
    \local_viewerforh5p\hook_callbacks::before_footer();
    return '';
}
