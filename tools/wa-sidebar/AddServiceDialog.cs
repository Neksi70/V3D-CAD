namespace WaSidebar;

class AddServiceDialog : Form
{
    readonly TextBox _name = new() { Width = 300 };
    readonly TextBox _url = new() { Width = 300, Text = "https://" };
    public string ServiceName => _name.Text.Trim();
    public string ServiceUrl => _url.Text.Trim();

    public AddServiceDialog()
    {
        Text = "Dienst hinzufügen";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
        TopMost = true;
        var t = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Padding = new Padding(10) };
        t.Controls.Add(new Label { Text = "Name:", AutoSize = true, Anchor = AnchorStyles.Left });
        t.Controls.Add(_name);
        t.Controls.Add(new Label { Text = "Adresse:", AutoSize = true, Anchor = AnchorStyles.Left });
        t.Controls.Add(_url);
        t.Controls.Add(new Label { Text = "Jeder Dienst bekommt ein eigenes,\ngetrenntes Anmelde-Profil.", AutoSize = true });
        var ok = new Button { Text = "Hinzufügen", DialogResult = DialogResult.OK, AutoSize = true };
        t.Controls.Add(ok);
        Controls.Add(t);
        AcceptButton = ok;
    }
}
