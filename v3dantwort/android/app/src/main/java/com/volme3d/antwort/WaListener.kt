package com.volme3d.antwort

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat

/**
 * Liest WhatsApp-Benachrichtigungen mit und legt daneben eine eigene
 * Benachrichtigung mit dem Knopf „🤖 Mit Claude antworten“.
 * Gesendet wird hier nie etwas – das passiert erst in AntwortActivity
 * auf ausdrücklichen Tipp.
 */
class WaListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in PAKETE) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val chat = auslesen(this, sbn) ?: return
        val alt = Speicher.chats[chat.schluessel]
        Speicher.chats[chat.schluessel] = chat
        if (!Speicher.knopf(this) || (chat.gruppe && !Speicher.gruppen(this))) return
        // Nur bei wirklich neuer Nachricht melden (WhatsApp aktualisiert oft dieselbe)
        if (alt != null && alt.letzte == chat.letzte && alt.verlauf.size == chat.verlauf.size) return
        knopfZeigen(this, chat)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (sbn.packageName !in PAKETE) return
        // Chat in WhatsApp gelesen → unser Knopf verschwindet auch; der Chat bleibt in der Liste.
        val n = sbn.notification
        val schluessel = n.shortcutId ?: sbn.tag ?: return
        getSystemService(NotificationManager::class.java).cancel(schluessel.hashCode())
    }

    companion object {
        val PAKETE = setOf("com.whatsapp", "com.whatsapp.w4b")
        const val KANAL = "knopf"

        fun auslesen(c: Context, sbn: StatusBarNotification): Chat? {
            val n = sbn.notification
            val stil = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
            val ex = n.extras
            val titelRoh = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: return null
            val verlauf = mutableListOf<Nachricht>()
            if (stil != null && stil.messages.isNotEmpty()) {
                for (m in stil.messages) {
                    val text = m.text?.toString() ?: continue
                    // person == null bzw. Nutzer selbst → eigene Nachricht
                    val von = m.person?.name?.toString()
                    verlauf += Nachricht(von, text, m.timestamp)
                }
            } else {
                val text = ex.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: return null
                verlauf += Nachricht(titelRoh, text, sbn.postTime)
            }
            if (verlauf.isEmpty()) return null
            // Statusmeldungen von WhatsApp selbst ("Suche nach neuen Nachrichten", Backup …) haben keinen Antworten-Knopf
            val aktion = n.actions?.firstOrNull { a -> a.remoteInputs?.isNotEmpty() == true }
            if (aktion == null && stil == null) return null
            val gruppe = stil?.isGroupConversation == true
            val titel = stil?.conversationTitle?.toString() ?: titelRoh
            val schluessel = n.shortcutId ?: sbn.tag ?: titel
            return Chat(schluessel, titel, sbn.packageName, gruppe, verlauf, aktion, n.contentIntent, sbn.postTime)
        }

        fun kanalAnlegen(c: Context) {
            val nm = c.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(KANAL) == null) {
                val k = NotificationChannel(KANAL, "Antwort-Knopf", NotificationManager.IMPORTANCE_DEFAULT)
                k.description = "Knopf „Mit Claude antworten“ zu jeder WhatsApp-Nachricht"
                k.setSound(null, null)
                k.enableVibration(false)
                nm.createNotificationChannel(k)
            }
        }

        fun knopfZeigen(c: Context, chat: Chat) {
            kanalAnlegen(c)
            val auf = Intent(c, AntwortActivity::class.java)
                .putExtra(AntwortActivity.EXTRA_CHAT, chat.schluessel)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val pi = PendingIntent.getActivity(c, chat.schluessel.hashCode(), auf,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val vorschau = chat.letzte.let { if (it.length > 80) it.take(80) + "…" else it }
            val n = Notification.Builder(c, KANAL)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF25D366.toInt())
                .setContentTitle("🤖 Antwort an ${chat.titel}?")
                .setContentText(vorschau)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_RECOMMENDATION)
                .addAction(Notification.Action.Builder(null, "🤖 Mit Claude antworten", pi).build())
                .build()
            c.getSystemService(NotificationManager::class.java).notify(chat.schluessel.hashCode(), n)
        }
    }
}
