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
var _ = cockpit.gettext;

//var $ = require("jquery");
var React = require("react");
var Services = require("./services.jsx").Services;
var left_click = require("./utils.js").left_click;

var ManifestLauncher = React.createClass({
    render: function () {
        var self = this;
        function go() {
            cockpit.jump([ self.props.package ]);
        }
        return (
            // TODO - make links based on the actual manifest
            <a onClick={left_click(go)}>{cockpit.format(_("Go to $0"), self.props.package)}</a>
        );
    }
});

var Launcher = React.createClass({
    render: function () {
        var self = this;
        var packages = self.props.launchables.filter(function (l) { return l.type == "cockpit-package"; });
        var services = self.props.launchables.filter(function (l) { return l.type == "systemd-unit"; });

        if (packages.length === 0 && services.length === 0)
            return (
                <p>This application can not be launched here.</p>
            );

        if (packages.length > 0 && !cockpit.manifests[packages[0].name]) {
            return (
                <p>You need to log out and in again in order to see this application.  (This will not be necessary in the future.)</p>
            );
        }

        return (
            <div>
                {
                    packages.map(function (p) {
                        return <ManifestLauncher package={p.name}/>;
                    })
                }
                <Services services={services}/>
            </div>
        );
    }
});

module.exports = {
    Launcher: Launcher
};
