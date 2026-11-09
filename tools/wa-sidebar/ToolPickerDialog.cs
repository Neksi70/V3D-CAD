namespace WaSidebar;

/// Auswahl, welche V3D Tools in der Leiste erscheinen.
class ToolPickerDialog : Form
{
    readonly TreeView _tree = new() { CheckBoxes = true, Dock = DockStyle.Fill, HideSelection = true };
    readonly Label _info = new() { Dock = DockStyle.Top, Height = 40, Padding = new Padding(8, 6, 8, 0) };
    bool _updating;

    public ToolPickerDialog(List<CatalogItem> items, bool online, HashSet<string> selectedUrls)
    {
        Text = "V3D Tools in der Leiste";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(460, 640);
        MinimizeBox = MaximizeBox = false;
        TopMost = true;
        ShowInTaskbar = false;
        _info.Text = online
            ? "Haken setzen = Tool erscheint in der Leiste.\nListe frisch von der V3D-Tools-Seite geladen."
            : "Haken setzen = Tool erscheint in der Leiste.\nTools-Seite nicht erreichbar, eingebaute Liste.";

        foreach (var grp in items.GroupBy(i => i.Category))
        {
            var cat = new TreeNode(grp.Key);
            foreach (var it in grp)
                cat.Nodes.Add(new TreeNode(it.Name) { Tag = it, Checked = selectedUrls.Contains(it.Url), ToolTipText = it.Url });
            cat.Checked = cat.Nodes.Count > 0 && cat.Nodes.Cast<TreeNode>().All(n => n.Checked);
            _tree.Nodes.Add(cat);
        }
        _tree.ShowNodeToolTips = true;
        _tree.ExpandAll();
        if (_tree.Nodes.Count > 0) _tree.Nodes[0].EnsureVisible();
        _tree.AfterCheck += (_, e) =>
        {
            if (_updating) return;
            _updating = true;
            if (e.Node.Tag == null) foreach (TreeNode c in e.Node.Nodes) c.Checked = e.Node.Checked;
            else if (e.Node.Parent != null) e.Node.Parent.Checked = e.Node.Parent.Nodes.Cast<TreeNode>().All(n => n.Checked);
            _updating = false;
        };

        var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, Height = 44, Padding = new Padding(6) };
        var ok = new Button { Text = "Übernehmen", DialogResult = DialogResult.OK, AutoSize = true };
        var cancel = new Button { Text = "Abbrechen", DialogResult = DialogResult.Cancel, AutoSize = true };
        bottom.Controls.Add(ok);
        bottom.Controls.Add(cancel);
        Controls.Add(_tree);
        Controls.Add(_info);
        Controls.Add(bottom);
        AcceptButton = ok;
        CancelButton = cancel;
    }

    public List<CatalogItem> Selected =>
        _tree.Nodes.Cast<TreeNode>().SelectMany(c => c.Nodes.Cast<TreeNode>())
            .Where(n => n.Checked).Select(n => (CatalogItem)n.Tag).ToList();
}
