package com.volme3d.v3dabos

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var rv: RecyclerView
    private lateinit var tvSumme: TextView
    private lateinit var tvJahr: TextView
    private lateinit var tvPotenzial: TextView
    private lateinit var tvHinweis: TextView
    private lateinit var tvLeer: TextView

    private val zeilen = ArrayList<Zeile>()
    private var nutzung: Map<String, Nutzung> = emptyMap()
    private var zeigeGekuendigte = false

    private val pool = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private val fragePost = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* abgelehnt heisst nur: keine Fristen-Erinnerung */ }

    data class Zeile(val abo: Abo, val bewertung: Bewertung)

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_main)
        title = getString(R.string.app_name)

        rv = findViewById(R.id.rv)
        tvSumme = findViewById(R.id.tvSumme)
        tvJahr = findViewById(R.id.tvJahr)
        tvPotenzial = findViewById(R.id.tvPotenzial)
        tvHinweis = findViewById(R.id.tvHinweis)
        tvLeer = findViewById(R.id.tvLeer)

        rv.layoutManager = LinearLayoutManager(this)
        rv.adapter = Adapter()

        findViewById<FloatingActionButton>(R.id.fab).setOnClickListener {
            startActivity(Intent(this, EditActivity::class.java))
        }
        findViewById<View>(R.id.btnScan).setOnClickListener {
            startActivity(Intent(this, ScanActivity::class.java))
        }
        findViewById<View>(R.id.btnKonto).setOnClickListener {
            startActivity(Intent(this, ImportActivity::class.java))
        }
        tvHinweis.setOnClickListener { startActivity(NutzungQuelle.einstellungenIntent()) }

        Fristen.plane(this)
        if (Build.VERSION.SDK_INT >= 33) {
            fragePost.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        Store.neuLaden()
        Fristen.schreibeTermineFort(this)
        aktualisiere()
    }

    private fun aktualisiere() {
        val hatRecht = NutzungQuelle.hatBerechtigung(this)
        tvHinweis.visibility = if (hatRecht) View.GONE else View.VISIBLE
        if (!hatRecht) {
            tvHinweis.text = "V3D Abos darf die Nutzungsdaten noch nicht lesen und kann " +
                "deshalb nicht sehen, welche Abos brachliegen.\n\nHier tippen → V3D Abos " +
                "in der Liste suchen → Zugriff erlauben."
        }

        // Die Nutzungsstatistik ueber 90 Tage kostet je nach Geraet ein paar hundert
        // Millisekunden — nicht im UI-Thread.
        pool.execute {
            val n = runCatching { NutzungQuelle.messe(this) }.getOrDefault(emptyMap())
            ui.post { nutzung = n; baueListe() }
        }
    }

    private fun baueListe() {
        val heute = LocalDate.now()
        val alle = Store.alle(this)
        zeilen.clear()
        for (a in alle) {
            if (!zeigeGekuendigte && a.status != Status.AKTIV) continue
            val n = if (a.appPaket.isBlank()) null else nutzung[a.appPaket]
            zeilen.add(Zeile(a, Bewerter.bewerte(a, n, heute)))
        }
        zeilen.sortByDescending { Bewerter.rang(it.abo, it.bewertung) }
        rv.adapter?.notifyDataSetChanged()

        val aktive = alle.filter { it.status == Status.AKTIV }
        val monat = aktive.sumOf { it.monatsCent }
        tvSumme.text = "${Fmt.euro(monat)} / Monat"
        tvJahr.text = "${Fmt.euro(aktive.sumOf { it.jahresCent })} im Jahr · ${aktive.size} " +
            if (aktive.size == 1) "Abo" else "Abos"

        val tot = zeilen.filter { it.bewertung.ampel == Ampel.ROT }
        if (tot.isEmpty()) {
            tvPotenzial.visibility = View.GONE
        } else {
            tvPotenzial.visibility = View.VISIBLE
            val cent = tot.sumOf { it.abo.monatsCent }
            tvPotenzial.text = "${tot.size} ungenutzt → ${Fmt.euro(cent * 12)} im Jahr sparen"
        }

        tvLeer.visibility = if (alle.isEmpty()) View.VISIBLE else View.GONE
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main, menu)
        return true
    }

    override fun onPrepareOptionsMenu(menu: Menu): Boolean {
        menu.findItem(R.id.mi_gekuendigt)?.isChecked = zeigeGekuendigte
        return super.onPrepareOptionsMenu(menu)
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.mi_einstellungen -> {
            startActivity(Intent(this, EinstellungenActivity::class.java)); true
        }
        R.id.mi_gekuendigt -> {
            zeigeGekuendigte = !zeigeGekuendigte
            item.isChecked = zeigeGekuendigte
            baueListe(); true
        }
        else -> super.onOptionsItemSelected(item)
    }

    private inner class Adapter : RecyclerView.Adapter<Halter>() {
        override fun onCreateViewHolder(p: ViewGroup, t: Int) =
            Halter(LayoutInflater.from(p.context).inflate(R.layout.item_abo, p, false))

        override fun getItemCount() = zeilen.size

        override fun onBindViewHolder(h: Halter, i: Int) {
            val z = zeilen[i]
            h.name.text = z.abo.name
            h.grund.text = z.bewertung.grund
            h.preis.text = Fmt.euro(z.abo.monatsCent)
            h.intervall.text = if (z.abo.intervall == Intervall.MONATLICH) "im Monat"
                               else "${Fmt.euro(z.abo.betragCent)} ${z.abo.intervall.anzeige}"

            val farbe = when (z.bewertung.ampel) {
                Ampel.ROT -> R.color.ampel_rot
                Ampel.GELB -> R.color.ampel_gelb
                Ampel.GRUEN -> R.color.ampel_gruen
                Ampel.GRAU -> R.color.ampel_grau
            }
            h.ampel.setBackgroundColor(ContextCompat.getColor(this@MainActivity, farbe))

            val teile = ArrayList<String>()
            z.bewertung.centProStunde?.let { teile.add("${Fmt.euro(it)} je Stunde Nutzung") }
            z.abo.spaetesterKuendigungstag()?.let { tag ->
                val tage = ChronoUnit.DAYS.between(LocalDate.now(), tag)
                if (z.abo.status == Status.AKTIV) {
                    teile.add(
                        when {
                            tage < 0 -> "Frist für den nächsten Termin verpasst"
                            tage == 0L -> "heute ist der letzte Kündigungstag!"
                            tage <= 30 -> "noch $tage Tage bis zur Kündigungsfrist"
                            else -> "kündbar bis ${Fmt.datum(tag)}"
                        }
                    )
                }
            }
            h.frist.text = teile.joinToString(" · ")
            h.frist.visibility = if (teile.isEmpty()) View.GONE else View.VISIBLE

            h.itemView.setOnClickListener {
                startActivity(Intent(this@MainActivity, EditActivity::class.java)
                    .putExtra("id", z.abo.id))
            }
        }
    }

    private class Halter(v: View) : RecyclerView.ViewHolder(v) {
        val ampel: View = v.findViewById(R.id.vAmpel)
        val name: TextView = v.findViewById(R.id.tvName)
        val grund: TextView = v.findViewById(R.id.tvGrund)
        val frist: TextView = v.findViewById(R.id.tvFrist)
        val preis: TextView = v.findViewById(R.id.tvPreis)
        val intervall: TextView = v.findViewById(R.id.tvIntervall)
    }
}
