/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import sha1 from "js-sha1";
import stable_stringify from "json-stable-stringify";

import { dialog_open, SelectOne, TextInput, PassInput, Intermission } from "./dialogx.jsx";
import { decode_filename } from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";

import * as python from "python.jsx";
import luksmeta_monitor_hack_py from "raw!./luksmeta-monitor-hack.py";
import clevis_luks_passphrase_sh from "raw!./clevis-luks-passphrase.sh";

const _ = cockpit.gettext;

/* Tang advertisement utilities
 */

function get_tang_adv(url) {
    return cockpit.spawn([ "curl", "-sSf", url + "/adv" ], { err: "message" }).then(JSON.parse);
}

function tang_adv_payload(adv) {
    return JSON.parse(cockpit.utf8_decoder().decode(cockpit.base64_decode(adv["payload"])));
}

function jwk_b64_encode(bytes) {
    // Use the urlsafe character set, and strip the padding.
    return cockpit.base64_encode(bytes).replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, '');
}

function compute_thp(jwk) {
    var REQUIRED_ATTRS = {
        'RSA': ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
        'EC':  ['kty', 'crv', 'x', 'y'],
        'oct': ['kty', 'k'],
    };

    var req = REQUIRED_ATTRS[jwk.kty];
    var norm = { };
    req.forEach(k => { if (k in jwk) norm[k] = jwk[k]; });
    return jwk_b64_encode(sha1.digest(stable_stringify(norm)));
}

function compute_sigkey_thps(adv) {
    function is_signing_key(jwk) {
        if (!jwk.use && !jwk.key_ops)
            return true;
        if (jwk.use == "sig")
            return true;
        if (jwk.key_ops && jwk.key_ops.indexOf("verify") >= 0)
            return true;
        return false;
    }

    return adv.keys.filter(is_signing_key).map(compute_thp);
}

/* Clevis operations
 */

function clevis_add(block, pin, cfg, passphrase) {
    // HACK - clevis 6 has only "bind luks", let's use that for now
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "clevis", "bind", "luks", "-f", "-k", "-", "-d", dev, pin, JSON.stringify(cfg) ],
                         { superuser: true, err: "message" }).input(passphrase);
}

function clevis_remove(block, key) {
    // HACK - only clevis version 10 brings "luks unbind"
    // cryptsetup needs a terminal on stdin, even with -q or --key-file.
    var script = 'cryptsetup luksKillSlot -q "$0" "$1" && luksmeta wipe -d "$0" -s "$1" -f';
    return cockpit.spawn([ "/bin/sh", "-c", script, decode_filename(block.Device), key.slot ],
                         { superuser: true, err: "message", pty: true });
}

function clevis_recover_passphrase(block) {
    var dev = decode_filename(block.Device);
    return cockpit.script(clevis_luks_passphrase_sh, [ dev ],
                          { superuser: true, err: "message" })
            .then(output => {
                if (output == "")
                    return cockpit.reject(_("No passphrase could be retrieved from keyservers. Please provide a existing passphrase."));
                return output;
            });
}

/* Passphrase operations
 */

function passphrase_add(block, new_passphrase, old_passphrase) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksAddKey", dev ],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase);
}

function passphrase_change(block, new_passphrase, old_passphrase) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksAddKey", dev ],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase);
}

function passphrase_remove(block, passphrase) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksRemoveKey", dev ],
                         { superuser: true, err: "message" }).input(passphrase);
}

/* Generic slot operations
 */

function slot_remove(block, slot) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksKillSlot", "-q", dev, slot.toString() ],
                         { superuser: true, err: "message", pty: true });
}

/* Dialogs
 */

function existing_passphrase_fields() {
    return [
        Intermission("You need to provide a existing passphrase in order to make changes to the keys.  If you leave the field empty, a passphrase will be retrieved from a configured keyserver, if possible."),
        PassInput("passphrase", _("Existing passphrase"), { })
    ];
}

function get_existing_passphrase(block, vals) {
    if (vals.passphrase)
        return Promise.resolve(vals.passphrase);
    else
        return clevis_recover_passphrase(block);
}

function add_dialog(client, block) {
    dialog_open({ Title: _("Add key slot"),
                  Fields: [
                      SelectOne("type", _("Slot type"),
                                { value: "tang" },
                                [ { value: "luks-passphrase", title: _("Passphrase") },
                                    { value: "tang", title: _("Tang keyserver") }
                                ]),
                      PassInput("new_passphrase", _("New passphrase"),
                                { visible: vals => vals.type == "luks-passphrase",
                                  validate: val => !val.length && _("Passphrase cannot be empty")
                                }),
                      PassInput("new_passphrase2", _("Confirm new passphrase"),
                                { visible: vals => vals.type == "luks-passphrase",
                                  validate: (val, vals) => vals.new_passphrase.length && vals.new_passphrase != val && _("Passphrases do not match")
                                }),
                      TextInput("tang_url", _("Tang keyserver URL"),
                                { visible: vals => vals.type == "tang",
                                  validate: val => !val.length && _("Tang URL cannot be empty")
                                })
                  ].concat(existing_passphrase_fields()),
                  Action: {
                      Title: _("Add"),
                      action: function (vals) {
                          return get_existing_passphrase(block, vals)
                                  .then(passphrase => {
                                      if (vals.type == "luks-passphrase") {
                                          return passphrase_add(block, vals.new_passphrase, passphrase);
                                      } else {
                                          return get_tang_adv(vals.tang_url).then(function (adv) {
                                              edit_tang_adv(client, block, null, vals.tang_url, adv, passphrase);
                                          });
                                      }
                                  });
                      }
                  }
    });
}

function edit_passphrase_dialog(block) {
    dialog_open({ Title: _("Change passphrase"),
                  Fields: [
                      PassInput("new_passphrase", _("New passphrase"),
                                { validate: val => !val.length && _("Passphrase cannot be empty")
                                }),
                      PassInput("new_passphrase2", _("Confirm new passphrase"),
                                { validate: (val, vals) => vals.new_passphrase.length && vals.new_passphrase != val && _("Passphrases do not match")
                                })
                  ].concat(existing_passphrase_fields()),
                  Action: {
                      Title: _("Apply"),
                      action: function (vals) {
                          return get_existing_passphrase(block, vals)
                                  .then(passphrase => {
                                      return passphrase_change(block, vals.new_passphrase, passphrase);
                                  });
                      }
                  }
    });
}

function edit_clevis_dialog(client, block, key) {
    dialog_open({ Title: _("Edit tang keyserver"),
                  Fields: [
                      TextInput("tang_url", _("Tang keyserver URL"),
                                { validate: val => !val.length && _("Tang URL cannot be empty"),
                                  value: key.url
                                })
                  ].concat(existing_passphrase_fields()),
                  Action: {
                      Title: _("Apply"),
                      action: function (vals) {
                          return get_existing_passphrase(block, vals).then(passphrase => {
                              return get_tang_adv(vals.tang_url).then(adv => {
                                  edit_tang_adv(client, block, null, vals.tang_url, adv, passphrase);
                              });
                          });
                      }
                  }
    });
}

function edit_tang_adv(client, block, key, url, adv, passphrase) {
    function action () {
        return clevis_add(block, "tang", { url: url, adv: adv }, passphrase)
                .then(() => {
                    if (key)
                        return clevis_remove(block, key);
                });
    }

    verify_tang_adv(url, adv,
                    _("Verify Key"),
                    null,
                    _("Trust Key"),
                    action);
}

function verify_tang_adv(url, adv, title, extra, action_title, action) {
    var port_pos = url.lastIndexOf(":");
    var host = (port_pos >= 0) ? url.substr(0, port_pos) : url;
    var port = (port_pos >= 0) ? url.substr(port_pos + 1) : "";
    var cmd = cockpit.format("ssh $0 tang-show-keys $1", host, port);

    var sigkey_thps = compute_sigkey_thps(tang_adv_payload(adv));

    dialog_open({ Title: title,
                  Body: (
                      <div>
                          { extra ? <p>{extra}</p> : null }
                          <p>
                              <span>{_("Manually verify the key on the server: ")}</span>
                              <pre>{cmd}</pre>
                          </p>
                          <p>
                              <span>{_("The output should match this text: ")}</span>
                              <pre><samp>{sigkey_thps.join("\n")}</samp></pre>
                          </p>
                      </div>
                  ),
                  Action: {
                      Title: action_title,
                      action: action
                  }
    });
}

function remove_passphrase_dialog(block, key) {
    dialog_open({ Title: _("Remove passphrase"),
                  Body: (
                      <div>
                          <p>{_("Removing a passphrase might prevent future unlocking of the volume and might thus cause data loss.")}</p>
                          <p>{cockpit.format(_("Please provide the passphrase that you want to remove. If you leave the input field empty, the passphrase in slot $0 will be removed."), key.slot)}</p>
                      </div>
                  ),
                  Fields: [
                      PassInput("passphrase", _("Passphrase to remove"), { })
                  ],
                  Action: {
                      DangerButton: true,
                      Title: _("Remove passphrase"),
                      action: function (vals) {
                          if (vals.passphrase != "") {
                              return passphrase_remove(block, vals.passphrase);
                          } else {
                              return slot_remove(block, key.slot);
                          }
                      }
                  }
    });
}

function remove_clevis_dialog(client, block, key) {
    dialog_open({ Title: _("Please confirm key slot removal"),
                  Body: (
                      <div>
                          <p>{_("Removing a key slot might prevent future unlocking of the volume and might thus cause data loss.")}</p>
                          <p>{_("Also, removing keyservers might prevent unattended booting.")}</p>
                      </div>
                  ),
                  Action: {
                      DangerButton: true,
                      Title: _("Remove key slot"),
                      action: function () {
                          return clevis_remove(block, key);
                      }
                  }
    });
}

export class ClevisSlots extends React.Component {
    constructor() {
        super();
        this.state = { slots: null };
    }

    monitor_slots(block) {
        // HACK - we only need this until UDisks2 has a Encrypted.Slots property or similar.
        if (block != this.monitored_block) {
            if (this.monitored_block)
                this.monitor_channel.close();
            this.monitored_block = block;
            if (block) {
                var dev = decode_filename(block.Device);
                this.monitor_channel = python.spawn(luksmeta_monitor_hack_py, [ dev ],
                                                    { superuser: "try" });
                var buf = "";
                this.monitor_channel.stream(output => {
                    var lines;
                    buf += output;
                    lines = buf.split("\n");
                    buf = lines[lines.length - 1];
                    if (lines.length >= 2) {
                        this.setState({ slots: JSON.parse(lines[lines.length - 2]) });
                    }
                });
            }
        }
    }

    componentDidUmount() {
        this.monitor_slots(null);
    }

    render() {
        var client = this.props.client;
        var block = this.props.block;

        if (!client.features.clevis)
            return null;

        this.monitor_slots(block);

        if (this.state.slots == null)
            return null;

        function decode_clevis_slot(slot) {
            if (slot.ClevisConfig) {
                var clevis = JSON.parse(slot.ClevisConfig.v);
                if (clevis.pin && clevis.pin == "tang" && clevis.tang) {
                    return { slot: slot.Index.v,
                             type: "tang",
                             url: clevis.tang.url
                    };
                } else {
                    return { slot: slot.Index.v,
                             type: "unknown",
                             pin: clevis.pin
                    };
                }
            } else {
                return { slot: slot.Index.v,
                         type: "luks-passphrase"
                };
            }
        }

        var keys = this.state.slots.map(decode_clevis_slot).filter(k => !!k);

        function key_description(key) {
            if (key.type == "tang")
                return key.url;
            else
                return cockpit.format(_("Unknown slot type '$0'"), key.pin);
        }

        var rows;
        if (keys.length == 0) {
            rows = <tr><td className="text-center">{_("No key slots")}</td></tr>;
        } else {
            rows = [ ];

            var add_row = (desc, edit, edit_excuse, remove) => {
                rows.push(
                    <tr>
                        <td>{desc}</td>
                        <td className="text-right">
                            <StorageButton onClick={edit} excuse={edit_excuse}>
                                <span className="pficon pficon-edit" />
                            </StorageButton>
                            { "\n" }
                            <StorageButton onClick={remove}
                                           excuse={keys.length == 1 ? _("The last key slot can not be removed") : null}>
                                <span className="fa fa-minus" />
                            </StorageButton>
                        </td>
                    </tr>
                );
            }

            var passphrase_count = 0;
            keys.sort((a, b) => a.slot - b.slot).forEach(key => {
                if (key.type == "luks-passphrase") {
                    add_row(cockpit.format(_("Passphrase $0"), ++passphrase_count),
                            () => edit_passphrase_dialog(block), null,
                            () => remove_passphrase_dialog(block, key));
                } else {
                    add_row(key_description(key),
                            () => edit_clevis_dialog(client, block, key),
                            key.type == "unknown" ? _("Key slots with unknown types can not be edited here") : null,
                            () => remove_clevis_dialog(client, block, key))
                }
            });
        }

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <div className="pull-right">
                        <StorageButton onClick={() => add_dialog(client, block)}>
                            <span className="fa fa-plus" />
                        </StorageButton>
                    </div>
                    {_("Key slots")}
                </div>
                <table className="table">
                    <tbody> { rows } </tbody>
                </table>
            </div>
        );
    }
}
