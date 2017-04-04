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

var PackageKit = require("./packagekit.js");
var utils = require("./utils.js");
var left_click = utils.left_click;

require("./application.css");

var _ = cockpit.gettext;

var Application = React.createClass({
    getInitialState: function() {
        return { progress: false }
    },
    render: function() {
        var self = this;
        var state = this.state;
        var metainfo_db = this.props.metainfo_db;
        var comp;

        if (!this.props.id)
            return null;

        comp = metainfo_db.components[this.props.id];

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

        function render_comp() {
            if (!comp) {
                if (metainfo_db.ready)
                    return <div>{_("Unknown Application")}</div>;
                else
                    return <div className="spinner"/>;
            }

            var progress_or_launch, button;
            if (state.progress && state.progress_pkgname == comp.pkgname) {
                progress_or_launch = (
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
                progress_or_launch = <a onClick={left_click(launch)}>{_("Go to Application")}</a>;
                button = <button className="btn btn-danger" onClick={left_click(remove)}>{_("Remove")}</button>;
            } else {
                progress_or_launch = null;
                button = <button className="btn btn-default" onClick={left_click(install)}>{_("Install")}</button>;
            }

            return (
                <div>
                    <table className="table app">
                        <tbody>
                            <tr>
                                {comp.icon? <td><img src={utils.icon_url(comp.icon)}/></td> : null}
                                <td>{comp.summary}</td>
                                <td>{progress_or_launch}</td>
                                <td>{button}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div className="app-description">{comp.description}</div>
                    { comp.screenshots && comp.screenshots.length > 0
                      ? <img className="app-screenshot" src={comp.screenshots[0].full}/>
                      : null
                    }
                </div>
            );
        }

        function navigate_up() {
            cockpit.location.go("/");
        }

        return (
            <div>
                <ol className="breadcrumb">
                    <li><a onClick={left_click(navigate_up)}>{_("Applications")}</a></li>
                    <li className="active">{comp? comp.name : this.props.id}</li>
                </ol>

                {render_comp()}
            </div>
        );
    }
});

module.exports = {
    Application: Application
};
