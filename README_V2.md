# Matter Desk v2 — broader matters + IA/application register

This upgrade preserves the existing Matter Desk and adds:

- Parent/broader matters (for example, Videocon).
- Many IAs/applications under each broader matter.
- Independent IA/application status, bench, next hearing date, prep notes and official link.
- Hearings linked to one or multiple IAs/applications.
- Editing of hearing entries after they are logged.
- Backdated hearing entries by choosing any past hearing date.
- IA-level upcoming-hearing dashboard.
- Excel sheets with an IA/Application Register followed by hearing history.

The migration is additive and preserves existing matter/hearing data. Legacy `next_ia_number` and historic `hearing.ia_number` values are migrated into the new application register automatically.
