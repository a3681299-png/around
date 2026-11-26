A text button in one of four looks; use one primary per panel at most.

- Provide the label as children. Labels say what happens: 保存, 元に戻す, エディターを開く.
- `around-btn--primary` for the one action the panel exists for. `around-btn` for everything else, `around-btn--ghost` for cancel and low-weight actions, `around-btn--danger` for removing or discarding.
- Height is `control` (32). `around-btn--dense` (20) only inside rows and the timesheet header.
- Show a shortcut with `around-kbd` inside the button, after the label.
- Disabled buttons keep their place and use `ink-faint`; never hide a button because it is unavailable.
- Button shapes are ruled: a 1px edge, `radius-control`. Never put a G-pen mark on a button.

Do not: put two primary buttons in one panel; use a filled button for a destructive action; use colour other than `cobalt` for primary.
