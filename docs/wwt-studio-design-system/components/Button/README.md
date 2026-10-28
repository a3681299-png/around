A text button in one of four looks; use one primary per panel at most.

- Provide the label as children. Labels say what happens: 保存, 元に戻す, エディターを開く.
- `ww-btn--primary` for the one action the panel exists for. `ww-btn` for everything else, `ww-btn--ghost` for cancel and low-weight actions, `ww-btn--danger` for removing or discarding.
- Height is `control` (32). `ww-btn--dense` (20) only inside rows and the timesheet header.
- Show a shortcut with `ww-kbd` inside the button, after the label.
- Disabled buttons keep their place and use `ink-faint`; never hide a button because it is unavailable.
- Button shapes are ruled: a 1px edge, `radius-control`. Never put a G-pen mark on a button.

Do not: put two primary buttons in one panel; use a filled button for a destructive action; use colour other than `cobalt` for primary.
