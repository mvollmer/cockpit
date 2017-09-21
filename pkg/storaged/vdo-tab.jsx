/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

"use strict";

var cockpit = require("cockpit");

var React = require("react");

var _ = cockpit.gettext;

var VdoTab =  React.createClass({
    render: function () {
        return (
            <div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Physical Size")}</td>
                        <td>{this.props.vdo.physical_size}</td>
                    </tr>
                    <tr>
                        <td>{_("Albireo Size")}</td>
                        <td>{this.props.vdo.alb_size}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    VdoTab: VdoTab
};
