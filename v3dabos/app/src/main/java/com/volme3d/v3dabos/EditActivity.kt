package com.volme3d.v3dabos

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import java.time.LocalDate

/** Abo anlegen oder bearbeiten. Ohne "id" im Intent wird ein neues angelegt. */
class EditActivity : AppCompatActivity() {

    private lateinit var abo: Abo
    private var neu = false
    private var geloescht = false

    private lateinit var etName: TextInputEditText
    private lateinit var etAnbieter: TextInputEditText
    private lateinit var etBetrag: TextInputEditText
    private lateinit var etFrist: TextInputEditText
    private lateinit var etLaufzeit: TextInputEditText
    private lateinit var etUrl: TextInputEditText
    private lateinit var etEmail: TextInputEditText
    private lateinit var etKunde: TextInputEditText
    private lateinit var etVertrag: TextInputEditText
    private lateinit var etNotiz: TextInputEditText
    private lateinit var spIntervall: Spinner
    private lateinit var spWeg: Spinner
    private lateinit var btnNaechste: MaterialButton
    private lateinit var btnBeginn: MaterialButton
    private lateinit var btnApp: MaterialButton

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_edit)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val vorhanden = Store.finde(this, intent.getStringExtra("id"))
        neu = vorhanden == null
        abo = vorhanden ?: Store.neu().also { a ->
            // Vorbelegung, wenn der Dienst aus dem Katalog kommt
            intent.getStringExtra("katalog")?.let { name ->
                Katalog.eintraege.firstOrNull { it.name == name }?.let { k -> ausKatalog(a, k) }
            }
            intent.getStringExtra("paket")?.let { p ->
                a.appPaket = p
                if (a.name.isBlank()) a.name = NutzungQuelle.label(this, p)
            }
        }
        title = if (neu) "Abo hinzufügen" else abo.name

        etName = findViewById(R.id.etName); etAnbieter = findViewById(R.id.etAnbieter)
        etBetrag = findViewById(R.id.etBetrag); etFrist = findViewById(R.id.etFrist)
        etLaufzeit = findViewById(R.id.etLaufzeit); etUrl = findViewById(R.id.etUrl)
        etEmail = findViewById(R.id.etEmail); etKunde = findViewById(R.id.etKunde)
        etVertrag = findViewById(R.id.etVertrag); etNotiz = findViewById(R.id.etNotiz)
        spIntervall = findViewById(R.id.spIntervall); spWeg = findViewById(R.id.spWeg)
        btnNaechste = findViewById(R.id.btnNaechste); btnBeginn = findViewById(R.id.btnBeginn)
        btnApp = findViewById(R.id.btnApp)

        spIntervall.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
            Intervall.values().map { it.anzeige })
        spWeg.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
            Weg.values().map { it.anzeige })

        btnNaechste.setOnClickListener {
            waehleDatum(abo.naechsteZahlung) { d -> abo.naechsteZahlung = d; zeigeDaten() }
        }
        btnBeginn.setOnClickListener {
            waehleDatum(abo.vertragsbeginn) { d -> abo.vertragsbeginn = d; zeigeDaten() }
        }
        btnApp.setOnClickListener { waehleApp() }

        findViewById<View>(R.id.btnKuendigen).setOnClickListener {
            uebernehmen()
            if (abo.name.isBlank()) { etName.error = "Name fehlt"; return@setOnClickListener }
            Store.ersetze(this, abo)
            startActivity(Intent(this, KuendigenActivity::class.java).putExtra("id", abo.id))
        }
        findViewById<View>(R.id.btnLoeschen).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage("„${abo.name}“ aus der Liste löschen? Das kündigt nichts – es " +
                    "entfernt nur den Eintrag hier.")
                .setPositiveButton("Löschen") { _, _ ->
                    Store.loesche(this, abo.id); geloescht = true; finish()
                }
                .setNegativeButton("Abbrechen", null).show()
        }

        fuelle()
    }

    private fun ausKatalog(a: Abo, k: KatalogEintrag) {
        a.name = k.name; a.anbieter = k.anbieter
        a.betragCent = k.richtpreisCent; a.intervall = k.intervall
        a.weg = k.weg; a.webUrl = k.webUrl
        a.appPaket = k.paket; a.playPaket = k.paket
    }

    private fun fuelle() {
        etName.setText(abo.name); etAnbieter.setText(abo.anbieter)
        if (abo.betragCent > 0) etBetrag.setText(String.format("%.2f", abo.betragCent / 100.0))
        etFrist.setText(if (abo.fristTage > 0) abo.fristTage.toString() else "")
        etLaufzeit.setText(if (abo.mindestlaufzeitMonate > 0) abo.mindestlaufzeitMonate.toString() else "")
        etUrl.setText(abo.webUrl); etEmail.setText(abo.kuendigungEmail)
        etKunde.setText(abo.kundennummer); etVertrag.setText(abo.vertragsnummer)
        etNotiz.setText(abo.notiz)
        spIntervall.setSelection(abo.intervall.ordinal)
        spWeg.setSelection(abo.weg.ordinal)
        zeigeDaten()

        val tv = findViewById<TextView>(R.id.tvStatus)
        if (abo.status != Status.AKTIV) {
            tv.visibility = View.VISIBLE
            val bis = abo.endetAm?.let { ", läuft bis ${Fmt.datum(it)}" } ?: ""
            tv.text = "Status: gekündigt${abo.gekuendigtAm?.let { " am ${Fmt.datum(it)}" } ?: ""}$bis"
            findViewById<MaterialButton>(R.id.btnKuendigen).text = "Kündigung rückgängig machen"
            findViewById<View>(R.id.btnKuendigen).setOnClickListener {
                abo.status = Status.AKTIV; abo.gekuendigtAm = null; abo.endetAm = null
                Store.ersetze(this, abo); recreate()
            }
        }
        if (abo.herkunft.isNotBlank()) {
            tv.visibility = View.VISIBLE
            tv.text = (tv.text.toString() + "\n" + abo.herkunft).trim()
        }
    }

    private fun zeigeDaten() {
        btnNaechste.text = "Nächste Zahlung: " +
            (abo.naechsteZahlung?.let { Fmt.datum(it) } ?: "—")
        btnBeginn.text = "Vertragsbeginn: " +
            (abo.vertragsbeginn?.let { Fmt.datum(it) } ?: "—")
        btnApp.text = "App wählen: " +
            (if (abo.appPaket.isBlank()) "keine" else NutzungQuelle.label(this, abo.appPaket))
    }

    private fun waehleDatum(vor: LocalDate?, dann: (LocalDate) -> Unit) {
        val d = vor ?: LocalDate.now()
        DatePickerDialog(this, { _, j, m, t -> dann(LocalDate.of(j, m + 1, t)) },
            d.year, d.monthValue - 1, d.dayOfMonth).show()
    }

    private fun waehleApp() {
        val apps = NutzungQuelle.installierteApps(this)
        val namen = arrayOf("— keine App —") + apps.map { it.label }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Welche App gehört zum Abo?")
            .setItems(namen) { _, i ->
                abo.appPaket = if (i == 0) "" else apps[i - 1].paket
                if (abo.playPaket.isBlank()) abo.playPaket = abo.appPaket
                zeigeDaten()
            }.show()
    }

    private fun uebernehmen() {
        abo.name = etName.text.toString().trim()
        abo.anbieter = etAnbieter.text.toString().trim()
        abo.betragCent = Fmt.euroZuCent(etBetrag.text.toString())
        abo.intervall = Intervall.values()[spIntervall.selectedItemPosition]
        abo.fristTage = etFrist.text.toString().trim().toIntOrNull() ?: 0
        abo.mindestlaufzeitMonate = etLaufzeit.text.toString().trim().toIntOrNull() ?: 0
        abo.weg = Weg.values()[spWeg.selectedItemPosition]
        abo.webUrl = etUrl.text.toString().trim()
        abo.kuendigungEmail = etEmail.text.toString().trim()
        abo.kundennummer = etKunde.text.toString().trim()
        abo.vertragsnummer = etVertrag.text.toString().trim()
        abo.notiz = etNotiz.text.toString().trim()
    }

    override fun onPause() {
        super.onPause()
        if (geloescht) return
        uebernehmen()
        // Ein leeres neues Abo nicht speichern — sonst sammelt die Liste Geisterzeilen.
        if (abo.name.isNotBlank()) {
            Store.ersetze(this, abo)
            Fristen.plane(this)
        }
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

}
