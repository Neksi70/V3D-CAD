package com.whatsapp

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Nachgebauter Chat-Bildschirm mit WhatsApps View-IDs. am start -n com.whatsapp/.Chat */
class Chat : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val w = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 80, 24, 24) }
        w.addView(TextView(this).apply { id = R.id.conversation_contact_name; text = "Jörg Schmidt"; textSize = 20f })
        fun blase(t: String, ich: Boolean) = TextView(this).apply {
            id = R.id.message_text; text = t; textSize = 16f; setPadding(24, 16, 24, 16)
            setBackgroundColor(if (ich) 0xFFD9FDD3.toInt() else 0xFFEEEEEE.toInt())
        }.also {
            val lp = LinearLayout.LayoutParams(700, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.gravity = if (ich) Gravity.END else Gravity.START; lp.topMargin = 16
            w.addView(it, lp)
        }
        blase("Hallo Volker, wie geht's?", false)
        blase("Gut, danke! Was gibt's?", true)
        blase("Können wir uns mal zusammensetzen wegen dem Workshop für unsere Azubis? Vormittags wäre ideal.", false)
        val leer = TextView(this); w.addView(leer, LinearLayout.LayoutParams(-1, 0, 1f))
        val feld = EditText(this).apply { id = R.id.entry; hint = "Nachricht" }
        w.addView(feld)
        w.addView(Button(this).apply { text = "Senden"; setOnClickListener {
            Log.i("FAKEWA", "CHAT_GESENDET: " + feld.text.toString().replace("\n", " | ")) } })
        setContentView(w)
    }
}
