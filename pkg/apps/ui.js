/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

var cockpit = require("cockpit");
var $ = require("jquery");

var React = require("react");
var ApplicationUI = require("./applicationui.jsx").ApplicationUI;

var appstream = require ("./appstream.js");

require("page.css");

function render_appui(metainfo) {
    React.render(React.createElement(ApplicationUI, { metainfo: metainfo }), $('#appui')[0]);
}

function show_appui(id)
{
    appstream.get_metainfo(id)
        .done(function (metainfo) {
            render_appui(metainfo);
            $('body').show();
        });
}

function navigate() {
    var path = cockpit.location.path;

    if (path.length == 1) {
        show_appui(path[0]);
    } else {
        console.warn("not a app location: " + path);
        cockpit.location = '';
    }
}

$(function () {
    cockpit.translate();

    $(cockpit).on("locationchanged", navigate);
    navigate();
});
