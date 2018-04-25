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

import cockpit from "cockpit";
import React from "react";

import * as PK from "packagekit.es6";

import { StorageButton, StorageUsageBar } from "./storage-controls.jsx";
import { format_fsys_usage, fmt_size, format_to_array, get_config } from "./utils.js";
import { nfs_fstab_dialog } from "./nfs-details.jsx";

// import { dialog_open } from "./dialogx.jsx";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function nfs_install_dialog(data, action) {
    var summary, extra_details = null, remove_details = null;

    if (data.extra_names.length > 0 && data.remove_names.length == 0) {
        summary = (
            <p>
                { format_to_array(_("$0 will be installed, along with additional packages:"),
                                  <strong>{data.missing_names.join(", ")}</strong>) }
                <ul className="package-list">{data.extra_names.map(id => <li>{id}</li>)}</ul>
            </p>
        );
    } else {
        summary = (
            <p>
                { format_to_array(_("$0 will be installed."),
                                  <strong>{data.missing_names.join(", ")}</strong>) }
            </p>
        );

        if (data.extra_names.length > 0)
            extra_details = (
                <p>
                    {_("Additional packages:")}
                    <ul className="package-list">{data.extra_names.map(id => <li>{id}</li>)}</ul>
                </p>
            );

        if (data.remove_names.length > 0)
            remove_details = (
                <p>
                    <span className="pficon pficon-warning-triangle-o"/> {_("Removals:")}
                    <ul className="package-list">{data.remove_names.map(id => <li>{id}</li>)}</ul>
                </p>
            );
    }

    show_modal_dialog({
        id: "dialog",
        title: _("Install Software"),
        body: (
            <div className="modal-body">
                { summary }
                { remove_details }
                { extra_details }
            </div>
        )
    }, {
        actions: [
            { caption: _("Install"),
              style: "primary",
              clicked: action
            }
        ],
        idle_message: (
            <div>
                { format_to_array(_("Total size: $0"), <strong>{fmt_size(data.download_size)}</strong>) }
            </div>
        )
    });
}

export class NFSPanel extends React.Component {
    constructor() {
        super();
        this.state = { promise: null,
                       error: null,
                       progress: null,
        };
    }

    render() {
        var self = this;
        var client = this.props.client;

        function make_nfs_mount(entry) {
            var fsys_size;
            if (entry.mounted)
                fsys_size = client.nfs.get_fsys_size(entry);

            var server = entry.fields[0].split(":")[0];
            var remote_dir = entry.fields[0].split(":")[1];

            function go(event) {
                if (!event || event.button !== 0)
                    return;
                cockpit.location.go([ "nfs", entry.fields[0], entry.fields[1] ]);
            }

            return (
                <tr onClick={go}>
                    <td>{ server + " " + remote_dir }</td>
                    <td>{ entry.fields[1] }</td>
                    <td>
                        { entry.mounted
                            ? <StorageUsageBar stats={fsys_size} critical={0.95}/>
                            : _("Not mounted")
                        }
                    </td>
                    <td className="usage-text">
                        { entry.mounted && fsys_size
                            ? format_fsys_usage(fsys_size[0], fsys_size[1])
                            : ""
                        }
                    </td>
                </tr>
            );
        }

        var mounts = client.nfs.entries.map(make_nfs_mount);

        function add() {
            nfs_fstab_dialog(client, null);
        }

        function install() {
            var p = PK.check_missing_packages(get_config("nfs_client_packages", [ ]),
                                              p => self.setState({ progress: p }))
                    .then(data => {
                        if (data.unavailable_names.length > 0) {
                            self.setState({ promise: null,
                                            error: format_to_array(_("$0 is not available from any repository."),
                                                                   <strong>{data.unavailable_names.join(", ")}</strong>),
                                            error_title: _("NFS support is not available."),
                                            error_dialog_title: _("NFS support is not available") });
                            return Promise.resolve();
                        }

                        if (data.missing_names.length === 0) {
                            // All packages are installed.  This shouldn't happen and we
                            // can't do anything about it, so let's pretend everything is okay.
                            client.features.nfs = true;
                            client.nfs.start();
                            self.setState({ promise: null });
                            return Promise.resolve();
                        }

                        self.setState({ promise: null });
                        nfs_install_dialog(data, () => {
                            var p = PK.install_missing_packages(data, p => self.setState({ progress: p }))
                                    .then(() => {
                                        client.features.nfs = true;
                                        client.nfs.start();
                                        self.setState({ promise: null });
                                    })
                                    .catch(error => {
                                        self.setState({ promise: null, error: error.toString(),
                                                        error_title: _("Error installing NFS support."),
                                                        error_dialog_title: _("Error installing Software") });
                                    });
                            self.setState({ promise: p, promise_title: _("Installing NFS support"),
                                            error: null, progress: null });
                            return Promise.resolve();
                        });
                    })
                    .catch(error => {
                        self.setState({ promise: null, error: error.toString(),
                                        error_title: _("NFS support is not available."),
                                        error_dialog_title: _("NFS support is not available") });
                    });
            self.setState({ promise: p, promise_title: _("Checking installed software"),
                            error: null, progress: null });
        }

        function info_heading(icon_class, text, title, message) {
            function show(event) {
                if (!event || event.button !== 0)
                    return;

                show_modal_dialog({
                    id: "dialog",
                    title: title,
                    body: (
                        <div className="modal-body">
                            { message }
                        </div>
                    )
                }, {
                    actions: [ ],
                    cancel_caption: _("Close")
                });
            }

            var link = null;
            if (title)
                link = <a onClick={show}>{_("View details...")}</a>;

            return (
                <span>
                    <span className={icon_class}/> {text} {link}
                </span>
            );
        }

        var heading_right = null;
        if (this.state.promise) {
            var p = this.state.progress;
            if (p && p.waiting) {
                heading_right = (
                    <span>
                        NFS support will be installed after other software management operations
                        finish. <span className="pficon pficon-in-progress"/>
                    </span>
                );
            } else {
                var text;
                if (p && p.package) {
                    var fmt;
                    if (p.info == PK.Enum.INFO_DOWNLOADING)
                        fmt = _("Downloading $0");
                    else if (p.info == PK.Enum.INFO_REMOVING)
                        fmt = _("Removing $0");
                    else
                        fmt = _("Installing $0");
                    text = format_to_array(fmt, <strong>{p.package}</strong>);
                } else {
                    text = this.state.promise_title;
                }
                heading_right = (
                    <span>{text} <span className="spinner spinner-sm spinner-inline"/></span>
                );
            }
        } else if (this.state.error) {
            heading_right = info_heading("pficon pficon-error-circle-o",
                                         this.state.error_title,
                                         this.state.error_dialog_title,
                                         this.state.error);
        } else if (!client.features.nfs) {
            heading_right = <StorageButton kind="primary" onClick={install}>{ _("Install NFS Support") }</StorageButton>;
        } else {
            heading_right = <StorageButton kind="primary" onClick={add}><span className="fa fa-plus"/></StorageButton>;
        }

        return (
            <div className="panel panel-default storage-mounts" id="nfs-mounts">
                <div className="panel-heading">
                    <span className="pull-right">
                        { heading_right }
                    </span>
                    <span>{_("NFS Mounts")}</span>
                </div>
                { mounts.length > 0
                    ? <table className="table table-hover">
                        <thead>
                            <tr>
                                <th className="mount-name">{_("Server")}</th>
                                <th className="mount-point">{_("Mount Point")}</th>
                                <th className="mount-size-graph">{_("Size")}</th>
                                <th className="mount-size-number">&nbsp;</th>
                            </tr>
                        </thead>
                        <tbody>
                            { mounts }
                        </tbody>
                    </table>
                    : (client.features.nfs
                        ? <div className="empty-panel-text">{_("No NFS mounts set up")}</div>
                        : <div className="empty-panel-text">{_("NFS support not installed")}</div>)
                }
            </div>
        );
    }
}
