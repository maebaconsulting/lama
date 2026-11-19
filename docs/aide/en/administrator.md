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

## Import

Settings, “Import”. Manager and administrator. Four imports: “Service catalogue”, “Clients”, “Products and stock”, “Upcoming appointments”.

1. “Download the template”: a file with the right columns and an example line. It opens in Excel.
2. Fill in one line per service, client, product or appointment, then delete the example line (lama refuses it).
3. Save the file. Two formats are accepted:
   - Excel workbook (.xlsx), uploaded as it is: only the first sheet is read; dates and times are recognised, and an amount shown as “15,000 FCFA” is read as 15000;
   - “CSV UTF-8”, for another spreadsheet.
   An old .xls workbook must first be saved as .xlsx: “File”, “Save As”, “Excel Workbook (.xlsx)”.
4. “Choose a file”: lama shows the preview, “Preview, nothing written yet”: lines read, additions, updates, refused lines with their spreadsheet number and the reason.
5. Fix the refused lines in the file, save it, then upload it again. “Import” stays greyed out while a line is refused.
6. “Import”: everything is written at once, or nothing. Each import is written to the access log.

Columns are recognised by their name on the first line, in any order, ignoring accents and capitals. What each import does:

- Catalogue: a service is recognised by its category and name, updated or added. The box “Deactivate services missing from the file” deactivates them without deleting them.
- Clients: recognised by their phone number. An existing record is only completed, never overwritten. The birthday is written DD-MM; a full date (date of birth, or “14-02” turned into a date by Excel) is reduced to the day and month.
- Products: recognised by their reference, otherwise by their name. A stock value replaces the stock, and each change is noted in the log.
- Appointments: upcoming only, confirmed, without any message to the client; an unknown client is created with the name and phone number of the line.

Amounts without spaces or symbols in a CSV (15000). For a currency with cents (euro), amounts are written in cents: 1500 for €15.00.
