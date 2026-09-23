# HML ConstructSync UI direction

## What the references contribute

- **Image 1:** A clear operations dashboard: persistent navigation, compact measures, an obvious report area, and dense records that remain scannable.
- **Image 2:** The primary visual model: a light navigation rail, generous white space, soft blue canvas, calm cards, rounded controls, and a friendly hierarchy.
- **ConstructSync translation:** Show construction work that needs a decision, project budget position, open delivery quantities, and linked transactions. Charts must come from the demo records; ecommerce sales graphics and fake trends do not belong here.

## Visual system

| Role | Token | Value |
| --- | --- | --- |
| Brand | `--brand` | `#24549a` |
| Bright accent | `--accent` | `#20a9cf` |
| Text | `--ink` | `#17283d` |
| Secondary text | `--muted` | `#64748b` |
| Canvas | `--paper` | `#f4f7fb` |
| Surface | `--surface` | `#ffffff` |

Use the existing Geist font at a 14px body size, larger page titles, and tabular numbers. Use white panels with a restrained border and very light shadow. Reserve blue fills for the active navigation item and primary action. Use pale blue, teal, amber, and rose only to explain distinct data or status. The supplied full HML logo belongs at the top of the light sidebar without cropping or recoloring.

## Layout and behavior

Desktop composition:

```text
┌──────────── sidebar ────────────┬──────────── project / role toolbar ────────────┐
│ HML logo                       │ Page title                         Main action │
│ Role's common destinations     │ Four live operational measures                │
│ Remaining workflow sections    │ Action queue              Project position   │
│ Prototype indicator            │ Request flow              Linked purchase    │
└─────────────────────────────────┴────────────────────────────────────────────────┘
```

On a phone, the sidebar becomes a drawer; the content forms one reading column beneath the project toolbar and visible demo label. This keeps the action queue and linked construction records ahead of decorative summaries.

- Desktop: persistent 244px sidebar, slim workspace toolbar, and a content column capped around 1500px. Group navigation by work stage. Put role switching, project filter, and notifications in the toolbar.
- Dashboard: page title and primary role action; four live measures; a prominent role queue; project position and a linked purchase snapshot. The queue is the first working destination.
- Registers: clear title, filters in a unified toolbar, roomy rows, visible statuses, and an obvious primary record link. Keep real table headers and horizontal scrolling where six columns would become illegible.
- Details: consistent breadcrumb/back link, record title, separate status labels, current owner and next step, then action area and linked information. Preserve the history timeline.
- Forms: group fields by task, keep labels visible, place errors next to the affected action or field, and keep save/submit choices distinct.
- Mobile: replace the persistent rail with a menu drawer, stack metrics and panels, allow wide records to scroll within their panel, and keep inputs at touch friendly sizes.

## Copy and accessibility

Use sentence case and concrete verbs such as “Submit MRF,” “Approve budget,” and “Post to site stock.” Keep the “Prototype / mock data” indicator visible so simulated actions are understood. Status meaning must include text, not color alone. Provide visible focus, keyboard dismissal for menus and dialogs, sensible empty states, and reduced motion support. Preserve the current workflow rules, routes, role permissions, and local storage format.

## Visual review checklist

Review the dashboard, a register, a record detail, and a form at desktop and phone widths. Check logo scale, navigation clarity, hierarchy, table readability, action placement, contrast, focus, clipping, and no page level horizontal overflow.
