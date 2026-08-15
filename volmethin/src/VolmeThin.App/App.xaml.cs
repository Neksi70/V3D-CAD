using System.Windows;

namespace VolmeThin.App;

public partial class App : Application
{
    public App()
    {
        DispatcherUnhandledException += (s, e) =>
        {
            MessageBox.Show(e.Exception.Message, "VolmeThin", MessageBoxButton.OK, MessageBoxImage.Error);
            e.Handled = true;
        };
    }
}
