package com.volme3d.v3dabos

import android.app.DatePickerDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Die drei Wege aus einem Abo — und die ehrliche Ansage dazu: den letzten Klick macht
 * der Mensch. Android erlaubt keiner App, einen fremden Vertrag zu beenden.
 */
class KuendigenActivity : AppCompatActivity() {

    private lateinit var abo: Abo
    private lateinit var etText: TextInputEditText
    private lateinit var btnEnde: MaterialButton

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_kuendigen)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val gefunden = Store.finde(this, intent.getStringExtra("id"))
        if (gefunden == null) { finish(); return }
        abo = gefunden
        title = "Kündigen: ${abo.name}"

        etText = findViewById(R.id.etText)
        btnEnde = findViewById(R.id.btnEnde)

        findViewById<TextView>(R.id.tvKopf).text = abo.name
        findViewById<TextView>(R.id.tvErsparnis).text =
            "spart ${Fmt.euro(abo.monatsCent)} im Monat · ${Fmt.euro(abo.jahresCent)} im Jahr"

        val tvFrist = findViewById<TextView>(R.id.tvFrist)
        val tag = abo.spaetesterKuendigungstag()
        tvFrist.text = when {
            tag == null -> "Kein Zahltermin hinterlegt – trag ihn im Abo nach, dann rechnet " +
                "V3D Abos die Frist aus und erinnert dich."
            else -> {
                val tage = ChronoUnit.DAYS.between(LocalDate.now(), tag)
                val frist = if (abo.fristTage > 0) "${abo.fristTage} Tage Frist · " else "jederzeit kündbar · "
                frist + when {
                    tage < 0 -> "für den ${Fmt.datum(abo.naechsteZahlung!!)} zu spät, es " +
                        "greift der Termin danach"
                    tage == 0L -> "heute ist der letzte Tag!"
                    else -> "noch $tage Tage (bis ${Fmt.datum(tag)})"
                }
            }
        }

        val tvUrl = findViewById<TextView>(R.id.tvUrl)
        tvUrl.text = abo.webUrl.ifBlank {
            "Keine Kündigungsseite hinterlegt – öffnet die Suche nach „${abo.name} kündigen“."
        }

        findViewById<View>(R.id.btnPlay).setOnClickListener {
            oeffne(Kuendigung.playUrl(abo))
        }
        findViewById<View>(R.id.btnWeb).setOnClickListener {
            oeffne(abo.webUrl.ifBlank {
                "https://www.google.com/search?q=" + Uri.encode("${abo.name} Abo kündigen")
            })
        }

        val absender = Store.absender(this)
        etText.setText(Kuendigung.text(abo, absender, LocalDate.now()))
        if (absender.leer) {
            Toast.makeText(this, "Tipp: Absenderdaten in den Einstellungen hinterlegen – " +
                "dann steht das Schreiben komplett da.", Toast.LENGTH_LONG).show()
        }

        findViewById<View>(R.id.btnMail).setOnClickListener { perMail() }
        findViewById<View>(R.id.btnTeilen).setOnClickListener { teilen() }
        findViewById<View>(R.id.btnKopieren).setOnClickListener {
            val cb = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cb.setPrimaryClip(ClipData.newPlainText("Kündigung", etText.text.toString()))
            Toast.makeText(this, "Kündigungstext kopiert", Toast.LENGTH_SHORT).show()
        }

        zeigeEnde()
        btnEnde.setOnClickListener {
            val d = abo.endetAm ?: abo.naechsteZahlung ?: LocalDate.now()
            DatePickerDialog(this, { _, j, m, t ->
                abo.endetAm = LocalDate.of(j, m + 1, t); zeigeEnde()
            }, d.year, d.monthValue - 1, d.dayOfMonth).show()
        }

        findViewById<View>(R.id.btnMarkieren).setOnClickListener {
            abo.status = Status.GEKUENDIGT
            abo.gekuendigtAm = LocalDate.now()
            Store.ersetze(this, abo)
            Fristen.plane(this)
            Toast.makeText(this, "„${abo.name}“ ist als gekündigt vermerkt", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun zeigeEnde() {
        btnEnde.text = "Vertragsende: " + (abo.endetAm?.let { Fmt.datum(it) } ?: "unbekannt")
    }

    private fun oeffne(url: String) {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        runCatching { startActivity(i) }.onFailure {
            Toast.makeText(this, "Keine App zum Öffnen von Links gefunden", Toast.LENGTH_SHORT).show()
        }
    }

    private fun perMail() {
        val i = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
        if (abo.kuendigungEmail.isNotBlank()) i.putExtra(Intent.EXTRA_EMAIL, arrayOf(abo.kuendigungEmail))
        i.putExtra(Intent.EXTRA_SUBJECT, Kuendigung.betreff(abo))
        i.putExtra(Intent.EXTRA_TEXT, etText.text.toString())
        runCatching { startActivity(i) }.onFailure {
            Toast.makeText(this, "Kein E-Mail-Programm eingerichtet – nimm „Teilen“",
                Toast.LENGTH_LONG).show()
        }
    }

    private fun teilen() {
        val i = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, Kuendigung.betreff(abo))
            .putExtra(Intent.EXTRA_TEXT, etText.text.toString())
        startActivity(Intent.createChooser(i, "Kündigung senden"))
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
