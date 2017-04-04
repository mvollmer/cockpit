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
var React = require("react");

var PackageKit = require("./packagekit");
var utils = require("./utils.js");
var left_click = utils.left_click;

var _ = cockpit.gettext;

var ApplicationRow =  React.createClass({
    getInitialState: function() {
        return { progress: false }
    },
    render: function () {
        var self = this;
        var comp = self.props.comp;
        var state = self.state;

        function navigate() {
            cockpit.location.go(comp.id);
        }

        function action(func, progress_title) {
            self.setState({ progress: 0, progress_title: progress_title, progress_pkgname: comp.pkgname });
            func(comp.pkgname, function (p) { self.setState({ progress: p }); }).
                      always(function () {
                          self.setState({ progress: false });
                      }).
                      fail(function(error) {
                          console.warn(error);
                      });
        }

        function install() {
            action(PackageKit.install, _("Installing"));
        }

        function remove() {
            action(PackageKit.remove, _("Removing"));
        }

        function cancel() {
            // XXX
        }

        function launch() {
            var i;
            for (i = 0; i < comp.launchables.length; i++) {
                if (comp.launchables[i].type == "cockpit-package") {
                    cockpit.jump([ comp.launchables[i].name ]);
                    return;
                }
            }

            cockpit.jump("/apps/ui#/" + window.encodeURIComponent(comp.id));
        }

        var name, summary_or_progress, button;

        if (comp.installed) {
            name = <a onClick={left_click(launch)}>{comp.name}</a>;
        } else {
            name = comp.name;
        }

        if (state.progress && state.progress_pkgname == comp.pkgname) {
            summary_or_progress = (
                <div>
                    <div className="progress-title">
                        {state.progress_title}
                    </div>
                    <div className="progress">
                        <div className="progress-bar" style={{ "width": state.progress + "%" }}>
                        </div>
                    </div>
                </div>
            );
            button = <button className="btn btn-primary" onClick={left_click(cancel)}>{_("Cancel")}</button>;
        } else if (comp.installed) {
            summary_or_progress = comp.summary;
            button = <button className="btn btn-danger" onClick={left_click(remove)}>{_("Remove")}</button>;
        } else {
            summary_or_progress = comp.summary;
            button = <button className="btn btn-default" onClick={left_click(install)}>{_("Install")}</button>;
        }

        return (
            <tr onClick={left_click(navigate)}>
                <td>{comp.icon? <img src={utils.icon_url(comp.icon)}/> : null}</td>
                <td>{name}</td>
                <td>{summary_or_progress}</td>
                <td>{button}</td>
            </tr>
        );
    }
});

var ApplicationList = React.createClass({
    render: function () {
        var comps = [ ];
        for (var id in this.props.metainfo_db.components)
            comps.push(this.props.metainfo_db.components[id]);
        comps.sort(function (a, b) { return a.name.localeCompare(b.name); });

        function render_comp(comp) {
            return <ApplicationRow comp={comp}/>;
        }

        if (comps.length === 0) {
            if (this.props.metainfo_db.ready)
                return _("No applications installed or available");
            else
                return <div className="spinner"/>;
        } else {
            return (
                <table className="table table-hover app-list">
                    <caption>{_("Applications")}</caption>
                    <tbody>
                        { comps.map(render_comp) }
                    </tbody>
                </table>
            );
        }
    }
});

module.exports = {
    ApplicationList: ApplicationList
};
