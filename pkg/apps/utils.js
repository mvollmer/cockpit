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

function left_click(fun) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        event.stopPropagation();
        return fun(event);
    };
}

function icon_url(path_or_url) {
    if (path_or_url[0] != '/')
        return path_or_url;

    var query = window.btoa(JSON.stringify({
        payload: "fsread1",
        binary: "raw",
        path: path_or_url,
        external: {
            "content-type": "image/png",
        }
    }));
    return "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query;
}

module.exports = {
    left_click: left_click,
    icon_url: icon_url
};
