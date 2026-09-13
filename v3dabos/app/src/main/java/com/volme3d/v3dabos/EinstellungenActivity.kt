package com.volme3d.v3dabos

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText

class EinstellungenActivity : AppCompatActivity() {

    private lateinit var etName: TextInputEditText
    private lateinit var etStrasse: TextInputEditText
    private lateinit var etOrt: TextInputEditText
    private lateinit var etEmail: TextInputEditText

    private val exportZiel = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? ->
        uri ?: return@registerForActivityResult
        runCatching {
            contentResolver.openOutputStream(uri)?.use {
                it.write(Store.schreibe(Store.alle(this)).toByteArray(Charsets.UTF_8))
            }
        }.onSuccess { Toast.makeText(this, "Exportiert", Toast.LENGTH_SHORT).show() }
         .onFailure { Toast.makeText(this, "Export fehlgeschlagen", Toast.LENGTH_SHORT).show() }
    }

    private val importQuelle = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? -> uri?.let { importiere(it) } }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_einstellungen)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        title = "Einstellungen"

        etName = findViewById(R.id.etName); etStrasse = findViewById(R.id.etStrasse)
        etOrt = findViewById(R.id.etOrt); etEmail = findViewById(R.id.etEmail)

        val a = Store.absender(this)
        etName.setText(a.name); etStrasse.setText(a.strasse)
        etOrt.setText(a.ort); etEmail.setText(a.email)

        val tvVorwarn = findViewById<TextView>(R.id.tvVorwarn)
        val sb = findViewById<SeekBar>(R.id.sbVorwarn)
        sb.progress = (Store.vorwarnTage(this) - 1).coerceIn(0, 59)
        fun zeige(p: Int) { tvVorwarn.text = "Erinnerung ${p + 1} Tage vor Fristende" }
        zeige(sb.progress)
        sb.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar?, p: Int, u: Boolean) = zeige(p)
            override fun onStartTrackingTouch(s: SeekBar?) {}
            override fun onStopTrackingTouch(s: SeekBar?) {
                Store.setzeVorwarnTage(this@EinstellungenActivity, s!!.progress + 1)
            }
        })

        findViewById<View>(R.id.btnExport).setOnClickListener { exportZiel.launch("v3dabos.json") }
        findViewById<View>(R.id.btnImport).setOnClickListener {
            importQuelle.launch(arrayOf("application/json", "text/*"))
        }
        findViewById<View>(R.id.btnBerechtigung).setOnClickListener {
            runCatching { startActivity(NutzungQuelle.einstellungenIntent()) }.onFailure {
                Toast.makeText(this, "Einstellungsseite nicht gefunden", Toast.LENGTH_SHORT).show()
            }
        }

        findViewById<TextView>(R.id.tvUeber).text =
            "V3D Abos ${paketVersion()}\n\n" +
            "Alle Daten bleiben auf dem Handy (abos.json im App-Speicher). Die App hat " +
            "keine Internet-Berechtigung und schickt nichts weg.\n\n" +
            "Was V3D Abos NICHT kann: deine Play-Store-Abos auslesen oder selbstständig " +
            "kündigen. Beides lässt Android keiner App zu – Play gibt die Abo-Liste nur der " +
            "kaufenden App heraus. V3D Abos misst stattdessen die App-Nutzung, erkennt " +
            "wiederkehrende Abbuchungen im Kontoauszug und bringt dich mit einem Klick auf " +
            "die richtige Kündigungsseite."
    }

    private fun paketVersion(): String = runCatching {
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    }.getOrDefault("")

    private fun importiere(uri: Uri) {
        val text = runCatching {
            contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) }
        }.getOrNull()
        if (text.isNullOrBlank()) {
            Toast.makeText(this, "Datei nicht lesbar", Toast.LENGTH_SHORT).show(); return
        }
        val neue = runCatching { Store.lies(text) }.getOrNull()
        if (neue == null) {
            Toast.makeText(this, "Das ist keine V3D-Abos-Datei", Toast.LENGTH_SHORT).show(); return
        }
        AlertDialog.Builder(this)
            .setTitle("${neue.size} Abos importieren")
            .setMessage("Ersetzen löscht die aktuelle Liste. Ergänzen hängt die Abos an.")
            .setPositiveButton("Ergänzen") { _, _ ->
                val liste = Store.alle(this)
                neue.forEach { n -> if (liste.none { it.id == n.id }) liste.add(n) }
                Store.speichere(this)
                Toast.makeText(this, "Ergänzt", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("Ersetzen") { _, _ ->
                val liste = Store.alle(this)
                liste.clear(); liste.addAll(neue)
                Store.speichere(this)
                Toast.makeText(this, "Ersetzt", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Abbrechen", null).show()
    }

    override fun onPause() {
        super.onPause()
        Store.setzeAbsender(this, Absender(
            etName.text.toString().trim(), etStrasse.text.toString().trim(),
            etOrt.text.toString().trim(), etEmail.text.toString().trim()
        ))
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
