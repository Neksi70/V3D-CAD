package com.volme3d.handy

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** Nach dem Neustart weiterlaufen, wenn die Verbindung vorher an war. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && Einstellungen.autostart(context)
            && Einstellungen.schluessel(context).isNotEmpty())
            ContextCompat.startForegroundService(context, Intent(context, AgentService::class.java))
    }
}
