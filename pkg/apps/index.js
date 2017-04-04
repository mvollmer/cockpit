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
var ApplicationList = require("./application-list.jsx").ApplicationList;
var Application = require("./application.jsx").Application;

require("page.css");

var metainfo_db = require("./appstream.js").get_metainfo_db();

function render_list() {
    React.render(React.createElement(ApplicationList, { metainfo_db: metainfo_db }),
                 $('#list')[0]);
}

function render_app() {
    React.render(React.createElement(Application, { metainfo_db: metainfo_db,
                                                    id: cockpit.location.path[0]
                                                  }),
                 $('#app')[0]);
}

function navigate() {
    var path = cockpit.location.path;

    if (path.length === 0) {
        $('#list-page').show();
        $('#app-page').hide();
    } else if (path.length === 1) {
        render_app();
        $('#list-page').hide();
        $('#app-page').show();
    } else { /* redirect */
        console.warn("not a networking location: " + path);
        cockpit.location = '';
    }
}

$(function () {
    cockpit.translate();

    $(metainfo_db).on("changed", render_list);
    $(metainfo_db).on("changed", render_app);

    render_list();
    $(cockpit).on("locationchanged", navigate);
    navigate();

    $('body').show();
});
