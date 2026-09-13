package com.volme3d.v3dabos

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.checkbox.MaterialCheckBox

/**
 * Ankreuzliste mit Zwischenüberschriften — geteilt von der App-Prüfung und dem
 * Kontoauszug-Import.
 */
class VorschlagAdapter(private val posten: List<Posten>) :
    RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    sealed class Posten {
        data class Kopf(val text: String) : Posten()
        data class Eintrag(
            val titel: String,
            val unter: String,
            val rechts: String,
            var gewaehlt: Boolean,
            /** Beliebige Nutzlast: KatalogEintrag, Fund oder Paketname. */
            val daten: Any?
        ) : Posten()
    }

    val gewaehlte: List<Posten.Eintrag>
        get() = posten.filterIsInstance<Posten.Eintrag>().filter { it.gewaehlt }

    override fun getItemViewType(i: Int) = if (posten[i] is Posten.Kopf) 0 else 1

    override fun onCreateViewHolder(p: ViewGroup, typ: Int): RecyclerView.ViewHolder {
        val inf = LayoutInflater.from(p.context)
        return if (typ == 0) KopfHalter(inf.inflate(R.layout.item_kopf, p, false))
               else EintragHalter(inf.inflate(R.layout.item_vorschlag, p, false))
    }

    override fun getItemCount() = posten.size

    override fun onBindViewHolder(h: RecyclerView.ViewHolder, i: Int) {
        when (val p = posten[i]) {
            is Posten.Kopf -> (h as KopfHalter).tv.text = p.text
            is Posten.Eintrag -> {
                val e = h as EintragHalter
                e.titel.text = p.titel
                e.unter.text = p.unter
                e.unter.visibility = if (p.unter.isBlank()) View.GONE else View.VISIBLE
                e.rechts.text = p.rechts
                e.cb.isChecked = p.gewaehlt
                e.itemView.setOnClickListener {
                    p.gewaehlt = !p.gewaehlt
                    e.cb.isChecked = p.gewaehlt
                }
            }
        }
    }

    private class KopfHalter(v: View) : RecyclerView.ViewHolder(v) {
        val tv: TextView = v.findViewById(R.id.tvKopfZeile)
    }

    private class EintragHalter(v: View) : RecyclerView.ViewHolder(v) {
        val cb: MaterialCheckBox = v.findViewById(R.id.cb)
        val titel: TextView = v.findViewById(R.id.tvTitel)
        val unter: TextView = v.findViewById(R.id.tvUnter)
        val rechts: TextView = v.findViewById(R.id.tvRechts)
    }
}
