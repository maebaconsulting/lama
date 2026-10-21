# Administrator's guide

This guide grows section by section. The technician's tasks (installation, backup drive, update by hand) are in `deploy/README.md`.

## Updates

Settings, “Updates”.

- Installed version: the lama version on the institute's server and its installation date.
- Available version: the latest published version, its date and “What changes”; otherwise “lama is up to date.”. lama checks by itself once a day; “Check now” does it right away. Without internet, the section shows “Cannot reach the version server” and nothing changes.
- “Update to X.Y.Z”: preferably outside opening hours. Tick the box, press the button, type your password again. A backup is made first; every screen shows “Maintenance in progress” for a few minutes, then reloads on the new version. If anything fails, lama goes back to the installed version by itself, database included, and the section gives the reason and what to do.
- Mode: “Manual” (default, a red dot on Settings signals a new version) or “Automatic at night (3:30 am)”.
- Last operation: date, version, result and reason. Each request, success, failure and mode change is written to the access log.

The manager sees the installed and available versions, without changing anything. Other accounts do not see the section.

No button, with the sentence “Updating from the application is not set up on this server yet”: the technician does a first update by hand. “Development version”: updates are done by hand.
