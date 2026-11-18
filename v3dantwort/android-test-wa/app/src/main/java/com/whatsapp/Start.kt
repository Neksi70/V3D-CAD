package com.whatsapp

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput

/** am start -n com.whatsapp/.Start --es text "…" --es von "Anna" */
class Start : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val von = intent.getStringExtra("von") ?: "Anna Becker"
        val text = intent.getStringExtra("text") ?: "Hallo!"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("m", "Nachrichten", NotificationManager.IMPORTANCE_HIGH))
        val ich = Person.Builder().setName("Du").build()
        val sie = Person.Builder().setName(von).build()
        val stil = NotificationCompat.MessagingStyle(ich)
            .addMessage("Guten Tag!", System.currentTimeMillis() - 60000, sie)
            .addMessage(text, System.currentTimeMillis(), sie)
        val ri = RemoteInput.Builder("antwort_text").setLabel("Antworten").build()
        val pi = PendingIntent.getBroadcast(this, 1, Intent(this, Antwort::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val auf = PendingIntent.getActivity(this, 2, Intent(this, Start::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, "m")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(von).setContentText(text)
            .setStyle(stil).setContentIntent(auf)
            .setShortcutId("4917612345678@s.whatsapp.net")
            .addAction(NotificationCompat.Action.Builder(0, "Antworten", pi).addRemoteInput(ri).build())
            .build()
        nm.notify("4917612345678@s.whatsapp.net", 1, n)
        finish()
    }
}

class Antwort : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val t = RemoteInput.getResultsFromIntent(i)?.getCharSequence("antwort_text")
        Log.i("FAKEWA", "ANTWORT_GESENDET: " + t.toString().replace("\n", " | "))
    }
}
