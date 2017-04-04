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

var watch_appstream = require("raw!./watch-appstream");

// var _ = cockpit.gettext;

var waiters = cockpit.defer();

var metainfo_db = {
    ready: false,
    components: [ ],

    wait: function(callback) {
        waiters.promise().done(callback);
    }
};

var metainfo_db_inited = false;

function get_metainfo_db() {
    if (!metainfo_db_inited) {
        metainfo_db_inited = true;
        var buf = "";
        cockpit.spawn([ "python3", "--", "-" ],
                      { superuser: "try" })
            .input(watch_appstream)
            .stream(function (data) {
                var lines;

                buf += data;
                lines = buf.split("\n");
                buf = lines[lines.length-1];
                if (lines.length >= 2) {
                    metainfo_db.components = JSON.parse(lines[lines.length-2]);
                    metainfo_db.ready = true;
                    $(metainfo_db).triggerHandler("changed");
                    waiters.resolve();
                }
            }).
            fail(function (error) {
                if (error != "closed") {
                    console.warn(error);
                }
            });
    }

    return metainfo_db;
}

function get_metainfo(id) {
    return cockpit.spawn([ "python3", "--", "-", id ],
                         { superuser: "try" })
        .input(watch_appstream)
        .then(
            function (data) {
                return JSON.parse(data);
            },
            function (error) {
                if (error != "closed") {
                    console.warn(error);
                }
            }
        );
}

module.exports = {
    get_metainfo_db: get_metainfo_db,
    get_metainfo: get_metainfo
};
