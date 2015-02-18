import re       # journal matching
import logging  # debug output in classes
from avocado.utils import process # Journal output

log=logging.getLogger("Journal")


class Journalctl:
    def __init__(self):
        pass

    def journal_messages(self, syslog_ids, log_level):
        """Return interesting journal messages"""

        # Journald does not always set trusted fields like
        # _SYSTEMD_UNIT or _EXE correctly for the last few messages of
        # a dying process, so we filter by the untrusted but reliable
        # SYSLOG_IDENTIFIER instead

        matches = " ".join(map(lambda id: "SYSLOG_IDENTIFIER=" + id, syslog_ids))

        # Some versions of journalctl terminate unsuccessfully when
        # the output is empty.  We work around this by ignoring the
        # exit status and including error messages from journalctl
        # itself in the returned messages.

        cmd = "journalctl 2>&1 -o cat -p %d %s" % (log_level, matches)
        out=process.run(cmd, shell=True, ignore_status=True)
        messages = str(out).splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            # No messages
            return [ ]
        else:
            return messages

    def audit_messages(self, type_pref):
        cmd = "journalctl -o cat SYSLOG_IDENTIFIER=kernel 2>&1 | grep 'type=%s.*audit' || true" % (type_pref, )
        out=process.run(cmd, shell=True, ignore_status=True)
        messages = str(out).splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            messages = [ ]
        return messages

    allowed_messages = [
        # This is a failed login, which happens every time
        "Returning error-response 401 with reason `Sorry'",

        # Reboots are ok
        "-- Reboot --",

        # Sometimes D-Bus goes away before us during shutdown
        "Lost the name com.redhat.Cockpit on the session message bus",
        "GLib-GIO:ERROR:gdbusobjectmanagerserver\\.c:.*:g_dbus_object_manager_server_emit_interfaces_.*: assertion failed \\(error == NULL\\): The connection is closed \\(g-io-error-quark, 18\\)",
        "Error sending message: The connection is closed",

        ## Bugs

        # https://bugs.freedesktop.org/show_bug.cgi?id=70540
        ".*ActUserManager: user .* has no username.*",

        # https://github.com/cockpit-project/cockpit/issues/48
        "Failed to load '.*': Key file does not have group 'Unit'",

        # https://github.com/cockpit-project/cockpit/issues/115
        "cockpit-testing\\.service: main process exited, code=exited, status=1/FAILURE",
        "Unit cockpit-testing\\.service entered failed state\\.",

        # https://bugs.freedesktop.org/show_bug.cgi?id=71092
        "logind\\.KillUser failed \\(Input/output error\\), trying systemd\\.KillUnit",

        # SELinux messages to ignore
        "(audit: )?type=1403 audit.*",
        "(audit: )?type=1404 audit.*",
    ]

    def allow_journal_messages(self, *patterns):
        """Don't fail if the journal containes a entry matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def allow_restart_journal_messages():
        self.allow_journal_messages("Error receiving data: Connection reset by peer",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Underlying GIOStream returned 0 bytes on an async read \\(g-io-error-quark, 0\\). Exiting.",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Error sending message: Broken pipe \\(g-io-error-quark, 44\\). Exiting.",
                                    # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1141137
                                    "localhost: bridge program failed: Child process killed by signal 9",
                                    "request timed out, closing")

    def check_journal_messages(self, machine=None):
        """Check for unexpected journal entries."""
        syslog_ids = [ "cockpitd", "cockpit-ws" ]
        messages = self.journal_messages(syslog_ids, 5)
        messages += self.audit_messages("14") # 14xx is selinux
        all_found = True
        for m in messages:
            found = False
            for p in self.allowed_messages:
                match = re.match(p, m)
                if match and match.group(0) == m:
                    found = True
                    break
            if not found:
                log.info( "Unexpected journal message '%s'" % m)
                all_found = False
#        if not all_found:
#            self.copy_journal("FAIL")
#            raise Error("There were unexpected journal messages")
