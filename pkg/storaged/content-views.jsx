/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

(function() {
    "use strict";

    var cockpit = require("cockpit");
    var utils = require("./utils.js");

    var mustache = require("mustache");

    var React = require("react");
    var CockpitListing = require("cockpit-components-listing.jsx");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    var FilesystemTab = React.createClass({
        onSamplesChanged: function () {
            this.setState({});
        },
        componentDidMount: function () {
            $(this.props.client.fsys_sizes).on("changed", this.onSamplesChanged);
        },
        componentWillUnmount: function () {
            $(this.props.client.fsys_sizes).off("changed", this.onSamplesChanged);
        },
        componentWillReceiveProps: function (newProps) {
            console.log("Props", this.props.block.path, newProps.block.path);
        },
        render: function() {
            var self = this;
            var block_fsys = self.props.block && self.props.client.blocks_fsys[self.props.block.path];
            var is_filesystem_mounted = (block_fsys && block_fsys.MountPoints.length > 0);
            var used;

            if (is_filesystem_mounted) {
                var mount = utils.decode_filename(block_fsys.MountPoints[0]);
                var samples = self.props.client.fsys_sizes.data[mount];
                if (samples)
                    used = cockpit.format(_("$0 of $1"),
                                          utils.fmt_size(samples[0]),
                                          utils.fmt_size(samples[1]));
                else
                    used = _("Unknown");
            } else {
                used = "-";
            }

            function btn(title, action, disabled) {
                return create_simple_btn(self.props.actions, title, action, [ self.props.block.path ], disabled);
            }

            return (
                <div>
                    <div className="pull-right">
                        { btn(_("Mount"),              "mount",        is_filesystem_mounted)   }
                        { btn(_("Unmount"),            "unmount",      !is_filesystem_mounted)  }
                        { btn(_("Filesystem Options"), "fsys_options", false)                   }
                    </div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Name")}</td>
                            <td>{this.props.block.IdLabel || "-"}</td>
                        </tr>
                        <tr>
                            <td>{_("Mount Points")}</td>
                            <td>{block_fsys && block_fsys.MountPoints.length > 0?
                                 block_fsys.MountPoints.map(utils.decode_filename) : "-"}</td>
                        </tr>
                        <tr>
                            <td>{_("Used")}</td>
                            <td>{used}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var CryptoTab = React.createClass({
        render: function() {
            var self = this;
            var cleartext_block = self.props.client.blocks_cleartext[self.props.block.path];

            function btn(title, action, disabled) {
                return create_simple_btn(self.props.actions, title, action, [ self.props.block.path ], disabled);
            }

            return (
                <div>
                    <div className="pull-right">
                        { btn(_("Lock"),               "lock",           cleartext_block === null) }
                        { btn(_("Unlock"),             "unlock",         cleartext_block !== null) }
                        { btn(_("Encryption Options"), "crypto_options", false)                    }
                    </div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Type")}</td>
                            <td>{this.props.block.IdType}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var VolumeTab = React.createClass({
        render: function() {
            var self = this;

            function btn(title, action, disabled) {
                return create_simple_btn(self.props.actions, title, action, [ self.props.lvol.path ], disabled);
            }

            return (
                <div>
                    <div className="pull-right">
                        { btn(_("Resize"),          "resize")                              }
                        { btn(_("Rename"),          "rename")                              }
                        { btn(_("Create Snapshot"), "create_snapshot")                     }
                        { btn(_("Activate"),        "activate", self.props.lvol.Active)    }
                        { btn(_("Deactivate"),      "deactivate", !self.props.lvol.Active) }
                    </div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Name")}</td>
                            <td>{this.props.lvol.Name}</td>
                        </tr>
                        <tr>
                            <td>{_("Size")}</td>
                            <td>{utils.fmt_size_long(this.props.lvol.Size)}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var PVolTab = React.createClass({
        render: function() {
            var block_pvol = this.props.client.blocks_pvol[this.props.block.path];
            var vgroup = this.props.client.vgroups[block_pvol.VolumeGroup];

            return (
                <div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Volume Group")}</td>
                            <td><a data-goto-vgroup={vgroup.Name}>{vgroup.Name}</a></td>
                        </tr>
                        <tr>
                            <td>{_("Free")}</td>
                            <td>{utils.fmt_size(block_pvol.FreeSize)}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var MDRaidMemberTab = React.createClass({
        render: function() {
            var mdraid = this.props.client.mdraids[this.props.block.MDRaidMember];
            return (
                <div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("RAID Device")}</td>
                            <td><a data-goto-mdraid={mdraid.UUID}>{utils.mdraid_name(mdraid)}</a></td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var PoolTab = React.createClass({
        render: function() {
            var self = this;

            function btn(title, action, disabled) {
                return create_simple_btn(self.props.actions, title, action, [ self.props.lvol.path ], disabled);
            }

            function perc(ratio) {
                return (ratio*100).toFixed(0) + "%";
            }

            return (
                <div>
                    <div className="pull-right">
                        { btn(_("Resize"), "resize") }
                        { btn(_("Rename"), "rename") }
                    </div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Name")}</td>
                            <td>{this.props.lvol.Name}</td>
                        </tr>
                        <tr>
                            <td>{_("Size")}</td>
                            <td>{utils.fmt_size_long(this.props.lvol.Size)}</td>
                        </tr>
                        <tr>
                            <td>{_("Data Used")}</td>
                            <td>{perc(this.props.lvol.DataAllocatedRatio)}</td>
                        </tr>
                        <tr>
                            <td>{_("Metadata Used")}</td>
                            <td>{perc(this.props.lvol.MetadataAllocatedRatio)}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var PartitionTab = React.createClass({
        render: function() {
            var block_part = this.props.client.blocks_part[this.props.block.path];

            return (
                <div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Name")}</td>
                            <td>{block_part.Name || "-"}</td>
                        </tr>
                        <tr>
                            <td>{_("Size")}</td>
                            <td>{utils.fmt_size_long(block_part.Size)}</td>
                        </tr>
                        <tr>
                            <td>{_("UUID")}</td>
                            <td>{block_part.UUID}</td>
                        </tr>
                        <tr>
                            <td>{_("Type")}</td>
                            <td>{block_part.Type}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var SwapTab =  React.createClass({
        onSamplesChanged: function () {
            this.setState({});
        },
        componentDidMount: function () {
            $(this.props.client.swap_sizes).on("changed", this.onSamplesChanged);
        },
        componentWillUnmount: function () {
            $(this.props.client.swap_sizes).off("changed", this.onSamplesChanged);
        },
        render: function () {
            var self = this;
            var block_swap = self.props.client.blocks_swap[self.props.block.path];
            var is_active = block_swap && block_swap.Active;
            var used;

            if (is_active) {
                var dev = utils.decode_filename(self.props.block.Device);
                var samples = self.props.client.swap_sizes.data[utils.decode_filename(self.props.block.Device)];
                if (samples)
                    used = utils.fmt_size(samples[0] - samples[1]);
                else
                    used = _("Unknown");
            } else {
                used = "-";
            }

            function btn(title, action, disabled) {
                return create_simple_btn(self.props.actions, title, action, [ self.props.block.path ], disabled);
            }

            return (
                <div>
                    <div className="pull-right">
                        { btn(_("Start"), "swap_start", is_active) }
                        { btn(_("Stop"),  "swap_stop",  !is_active) }
                    </div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Used")}</td>
                            <td>{used}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    var UnrecognizedTab =  React.createClass({
        render: function() {
            return (
                <div>
                    <table className="info-table-ct">
                        <tr>
                            <td>{_("Usage")}</td>
                            <td>{this.props.block.IdUsage || "-"}</td>
                        </tr>
                        <tr>
                            <td>{_("Type")}</td>
                            <td>{this.props.block.IdType || "-"}</td>
                        </tr>
                    </table>
                </div>
            );
        },
    });

    function create_tabs (client, actions, target, is_partition) {
        function endsWith(str, suffix) {
            return str.indexOf(suffix, str.length - suffix.length) !== -1;
        }

        var block = endsWith(target.iface, ".Block")? target : null;
        var block_lvm2 = block && client.blocks_lvm2[block.path];
        var block_pvol = block && client.blocks_pvol[block.path];

        var lvol = (endsWith(target.iface, ".LogicalVolume")?
                    target :
                    block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

        var is_filesystem         = (block && block.IdUsage == 'filesystem');
        var is_crypto             = (block && block.IdUsage == 'crypto');
        var is_extended_part      = (block && client.blocks_part[block.path] &&
                                     client.blocks_part[block.path].IsContainer);
        var is_formattable        = (block && !block.ReadOnly && !is_extended_part);

        var tabs = [ ];
        var row_action = null;

        function add_tab(name, renderer) {
            tabs.push(
                { name: name,
                  renderer: renderer,
                  data: {
                      client: client,
                      actions: actions,
                      block: block,
                      lvol: lvol,
                  }
                });
        }

        if (lvol) {
            if (lvol.Type == "pool") {
                add_tab(_("Pool"), PoolTab);
                row_action = create_simple_btn(actions,
                                               _("Create Thin Volume"),
                                               "create_thin", [ target.path ],
                                               false);
            } else {
                add_tab(_("Volume"), VolumeTab);
            }
        }

        if (is_partition) {
            add_tab(_("Partition"), PartitionTab);
        }

        if (is_filesystem) {
            add_tab(_("Filesystem"), FilesystemTab);
        } else if (is_crypto) {
            add_tab(_("Encryption"), CryptoTab);
        } else if (block_pvol && client.vgroups[block_pvol.VolumeGroup]) {
            add_tab(_("Physical Volume"), PVolTab);
        } else if (block && client.mdraids[block.MDRaidMember]) {
            add_tab(_("RAID Member"), MDRaidMemberTab);
        } else if (block && block.IdUsage == "other" && block.IdType == "swap") {
            add_tab(_("Swap"), SwapTab);
        } else if (block) {
            add_tab(_("Unrecognized Data"), UnrecognizedTab);
        }

        var tab_actions = [ ];

        if (is_formattable) {
            tab_actions.push(create_simple_btn(actions,
                                               _("Format"),
                                               "format", [ target.path ],
                                               false));
        }

        if (is_partition || lvol) {
            tab_actions.push(create_simple_btn(actions,
                                               _("Delete"),
                                               "delete", [ target.path ],
                                               false));
        }

        // Without tabs, the row can not be expanded and the
        // tab_actions button can't be accessed.  In that case, we put
        // them in the row itself.
        //
        // This shouldn't happen since we always include at keast the
        // UnrecognizedTab for blocks, and the Volume or Pool tab for
        // lvols.

        if (tabs.length == 0 && tab_actions.length > 0) {
            row_action = <span>{row_action}{tab_actions}</span>;
            tab_actions = [ ];
        }

        return {
            renderers: tabs,
            actions: [ <div>{tab_actions}</div> ],
            row_action: row_action,
        };
    }

    function create_simple_btn(actions, title, action, args, disabled) {
        function click(event) {
            var promise = actions[action].apply(this, args);
            if (promise)
                promise.fail(function (error) {
                    $('#error-popup-title').text(_("Error"));
                    $('#error-popup-message').text(error.toString());
                    $('#error-popup').modal('show');
                });
            event.stopPropagation();
        }

        return (
            <button className="btn btn-default storage-privileged"
                    onClick={click}
                    disabled={disabled}>
                {title}
            </button>
        );
    }

    function block_description (client, block) {
        var usage;
        var block_pvol = client.blocks_pvol[block.path];

        if (block.IdUsage == "filesystem") {
            usage = cockpit.format(C_("storage-id-desc", "$0 File System"), block.IdType);
        } else if (block.IdUsage == "raid") {
            if (block_pvol && client.vgroups[block_pvol.VolumeGroup]) {
                var vgroup = client.vgroups[block_pvol.VolumeGroup];
                usage = cockpit.format(_("Physical volume of $0"), vgroup.Name);
            } else if (client.mdraids[block.MDRaidMember]) {
                var mdraid = client.mdraids[block.MDRaidMember];
                usage = cockpit.format(_("Member of RAID Device $0"), utils.mdraid_name(mdraid));
            } else {
                usage = _("Member of RAID Device");
            }
        } else if (block.IdUsage == "crypto") {
            usage = C_("storage-id-desc", "Encrypted data");
        } else if (block.IdUsage == "other") {
            if (block.IdType == "swap") {
                usage = C_("storage-id-desc", "Swap Space");
            } else {
                usage = C_("storage-id-desc", "Other Data");
            }
        } else {
            usage = C_("storage-id-desc", "Unrecognized Data");
        }

        return {
            size: utils.fmt_size(block.Size),
            text: usage
        };
    }

    function append_row (rows, level, key, name, desc, tabs, job_object) {
        // Except in a very few cases, we don't both have a button and
        // a spinner in the same row, so we put them in the same
        // place.

        var last_column = null;
        if (job_object)
            last_column = (
                <span className="spinner spinner-sm"
                      style={{visibility: "hidden"}}
                      data-job-object={job_object}>
                </span>);
        if (tabs.row_action) {
            if (last_column) {
                last_column = <span>{last_column}{tabs.row_action}</span>;
            } else {
                last_column = tabs.row_action;
            }
        }

        var cols = [
            <span className={"content-level-" + level}>{desc.size + " " + desc.text}</span>,
            { name: name, 'header': true },
            { name: last_column, tight: true },
        ];
        rows.push(
            <CockpitListing.ListingRow key={key}
                                       columns={cols}
                                       tabRenderers={tabs.renderers}
                                       listingActions={tabs.actions}/>
        );
    }

    function append_non_partitioned_block (client, actions, rows, level, block, is_partition) {
        var id, name, desc, tabs;
        var cleartext_block;

        if (block.IdUsage == 'crypto')
            cleartext_block = client.blocks_cleartext[block.path];

        tabs = create_tabs(client, actions, block, is_partition);
        desc = block_description(client, block);

        append_row(rows, level, block.path, utils.block_name(block), desc, tabs, block.path);

        if (cleartext_block)
            append_device(client, actions, rows, level+1, cleartext_block);
    }

    function append_partitions (client, actions, rows, level, block) {
        var block_ptable = client.blocks_ptable[block.path];
        var device_level = level;

        var is_dos_partitioned = (block_ptable.Type == 'dos');
        var partitions = client.blocks_partitions[block.path];

        function append_free_space (level, start, size) {
            var desc;

            // Storaged rounds the start up to the next MiB,
            // so let's do the same and see whether there is
            // anything left that is worth showing.  (Storaged
            // really uses the formula below, and will really
            // 'round' start == 1 MiB to 2 MiB, for example.)

            var real_start = (Math.floor(start / (1024*1024)) + 1) * 1024*1024;
            if (start + size - real_start >= 1024*1024) {
                var btn = create_simple_btn(actions,
                                            _("Create Partition"),
                                            "create_partition", [ block.path, start, size,
                                                                  is_dos_partitioned && level > device_level ]);

                var cols = [
                    <span className={"content-level-" + level}>{utils.fmt_size(size) + " " + _("Free Space")}</span>,
                    "",
                    { element: btn, tight: true }
                ];

                rows.push(
                    <CockpitListing.ListingRow columns={cols}/>
                );
            }
        }

        function append_extended_partition (level, block, start, size) {
            var desc = {
                size: utils.fmt_size(size),
                text: _("Extended Partition")
            };
            var tabs = create_tabs(client, actions, block, true);
            append_row(rows, level, block.path, utils.block_name(block), desc, tabs, block.path);
            process_level(level + 1, start, size);
        }

        function process_level (level, container_start, container_size) {
            var n;
            var last_end = container_start;
            var total_end = container_start + container_size;
            var block, start, size, is_container, is_contained, partition_label;

            for (n = 0; n < partitions.length; n++) {
                block = client.blocks[partitions[n].path];
                start = partitions[n].Offset;
                size = partitions[n].Size;
                is_container = partitions[n].IsContainer;
                is_contained = partitions[n].IsContained;

                if (block === null)
                    continue;

                if (level === device_level && is_contained)
                    continue;

                if (level == device_level+1 && !is_contained)
                    continue;

                if (start < container_start || start+size > container_start+container_size)
                    continue;

                append_free_space(level, last_end, start - last_end);
                if (is_container) {
                    append_extended_partition(level, block, start, size);
                } else {
                    append_non_partitioned_block(client, actions, rows, level, block, true);
                }
                last_end = start + size;
            }

            append_free_space(level, last_end, total_end - last_end);
        }

        process_level(device_level, 0, block.Size);
    }

    function append_device (client, actions, rows, level, block) {
        if (client.blocks_ptable[block.path])
            append_partitions(client, actions, rows, level, block);
        else
            append_non_partitioned_block(client, actions, rows, level, block, null);
    }

    function block_rows(client, actions, block) {
        var rows = [ ];
        append_device(client, actions, rows, 0, block);
        return rows;
    }

    function block_content(client, actions, block) {
        if (!block)
            return null;

        var format_disk = (
            <div className="pull-right">{create_simple_btn(actions,
                                                           _("Create partition table"),
                                                           "format_disk", [ block.path ],
                                                           false)}
            </div>);

        return (
            <CockpitListing.Listing title="Content"
                                    actions={format_disk}>
                { block_rows(client, actions, block) }
            </CockpitListing.Listing>
        );
    }

    var Block = React.createClass({
        getInitialState: function () {
            return { block: null };
        },
        onClientChanged: function () {
            this.setState({ block: this.props.client.slashdevs_block[this.props.name] });
        },
        componentDidMount: function () {
            $(this.props.client).on("changed", this.onClientChanged);
            this.onClientChanged();
        },
        componentWillUnmount: function () {
            $(this.props.model).off("changed", this.onClientChanged);
        },
        render: function () {
            return block_content(this.props.client, this.props.actions, this.state.block);
        }
    });

    var MDRaid = React.createClass({
        getInitialState: function () {
            return { mdraid: null, block: null };
        },
        onClientChanged: function () {
            var mdraid = this.props.client.uuids_mdraid[this.props.name];
            var block = mdraid && this.props.client.mdraids_block[mdraid.path];
            this.setState({ mdraid: mdraid, block: block });
        },
        componentDidMount: function () {
            $(this.props.client).on("changed", this.onClientChanged);
            this.onClientChanged();
        },
        componentWillUnmount: function () {
            $(this.props.model).off("changed", this.onClientChanged);
        },

        render: function () {
            return block_content(this.props.client, this.props.actions, this.state.block);
        }
    });

    function append_logical_volume_block (client, actions, rows, level, block, lvol) {
        var tabs, desc;
        if (client.blocks_ptable[block.path]) {
            desc = {
                size: utils.fmt_size(block.Size),
                text: lvol.Name
            };
            tabs = create_tabs(clienta, actions, block, false);
            append_row(rows, level, block.path, utils.block_name(block), desc, tabs, block.path);
            append_partitions(client, actions, rows, level+1, block);
        } else {
            append_non_partitioned_block (client, actions, rows, level, block, false);
        }
    }

    function append_logical_volume (client, actions, rows, level, lvol) {
        var tabs, desc, ratio, block;

        if (lvol.Type == "pool") {
            ratio = Math.max(lvol.DataAllocatedRatio, lvol.MetadataAllocatedRatio);
            desc = {
                size: utils.fmt_size(lvol.Size),
                text: _("Pool for Thin Volumes")
            };
            tabs = create_tabs (client, actions, lvol, false);
            append_row (rows, level, lvol.Name, lvol.Name, desc, tabs, false);
            client.lvols_pool_members[lvol.path].forEach(function (member_lvol) {
                append_logical_volume (client, actions, rows, level+1, member_lvol);
            });
        } else {
            block = client.lvols_block[lvol.path];
            if (block)
                append_logical_volume_block (client, actions, rows, level, block, lvol);
            else {
                // If we can't find the block for a active
                // volume, Storaged or something below is
                // probably misbehaving, and we show it as
                // "unsupported".

                desc = {
                    size: utils.fmt_size(lvol.Size),
                    text: lvol.Active? _("Unsupported volume") : _("Inactive volume")
                }
                tabs = create_tabs (client, actions, lvol, false);
                append_row (rows, level, lvol.Name, lvol.Name, desc, tabs, false);
            }
        }
    }

    function vgroup_rows(client, actions, vgroup) {
        var rows = [ ];

        (client.vgroups_lvols[vgroup.path] || [ ]).forEach(function (lvol) {
            if (lvol.ThinPool == "/")
                append_logical_volume(client, actions, rows, 0, lvol);
        });

        if (vgroup.FreeSize > 0) {
            var btn = create_simple_btn (actions, _("Create Logical Volume"), "vgroup_create_lvol", [ vgroup.path ]);

            var cols = [
                <span className="content-level-0">{utils.fmt_size(vgroup.FreeSize) + " " + _("Free Space")}</span>,
                "",
                { element: btn, tight: true }
            ];

            rows.push(
                <CockpitListing.ListingRow columns={cols}/>
            );
        }

        return rows;
    }

    var VGroup = React.createClass({
        getInitialState: function () {
            return { vgroup: null };
        },
        onClientChanged: function () {
            this.setState({ vgroup: this.props.client.vgnames_vgroup[this.props.name] });
        },
        componentDidMount: function () {
            $(this.props.client).on("changed", this.onClientChanged);
            this.onClientChanged();
        },
        componentWillUnmount: function () {
            $(this.props.model).off("changed", this.onClientChanged);
        },

        render: function () {
            var vgroup = this.state.vgroup;

            if (!vgroup)
                return null;

            return (
                <CockpitListing.Listing title="Logical Volumes">
                    { vgroup_rows(this.props.client, this.props.actions, vgroup) }
                </CockpitListing.Listing>
            );
        }
    });

    module.exports = {
        Block: Block,
        MDRaid: MDRaid,
        VGroup: VGroup
    };

})();
