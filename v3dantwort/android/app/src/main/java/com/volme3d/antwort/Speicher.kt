package com.volme3d.antwort

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import java.util.concurrent.ConcurrentHashMap

/** Eine Nachricht im Verlauf; von = null heißt: von mir selbst. */
data class Nachricht(val von: String?, val text: String, val zeit: Long)

/** Ein WhatsApp-Chat, wie ihn die letzte Benachrichtigung zeigte. */
data class Chat(
    val schluessel: String,
    val titel: String,
    val paket: String,
    val gruppe: Boolean,
    val verlauf: List<Nachricht>,
    /** Antworten-Knopf der WhatsApp-Benachrichtigung (RemoteInput) – damit wird gesendet. */
    val antwortAktion: Notification.Action?,
    /** Öffnet genau diesen Chat in WhatsApp. */
    val oeffnen: PendingIntent?,
    val zeit: Long,
) {
    val letzte: String get() = verlauf.lastOrNull { it.von != null }?.text ?: verlauf.lastOrNull()?.text ?: ""
}

/**
 * Chats liegen nur im Arbeitsspeicher: die Antworten-Aktion (PendingIntent)
 * lässt sich ohnehin nicht dauerhaft speichern, und Nachrichtentexte sollen
 * nicht auf der Platte landen.
 */
object Speicher {
    val chats = ConcurrentHashMap<String, Chat>()

    fun neueste(n: Int = 30): List<Chat> = chats.values.sortedByDescending { it.zeit }.take(n)

    // --- Einstellungen ---
    private fun prefs(c: Context) = c.getSharedPreferences("einstellungen", Context.MODE_PRIVATE)
    fun url(c: Context): String = prefs(c).getString("url", "https://v3da.tailf05fe9.ts.net/antwort")!!
    fun key(c: Context): String = prefs(c).getString("key", "")!!
    fun gruppen(c: Context): Boolean = prefs(c).getBoolean("gruppen", false)
    fun knopf(c: Context): Boolean = prefs(c).getBoolean("knopf", true)
    fun termine(c: Context): Boolean = prefs(c).getBoolean("termine", true)
    fun setzen(c: Context, name: String, wert: Any) {
        val e = prefs(c).edit()
        when (wert) {
            is Boolean -> e.putBoolean(name, wert)
            else -> e.putString(name, wert.toString())
        }
        e.apply()
    }
}
