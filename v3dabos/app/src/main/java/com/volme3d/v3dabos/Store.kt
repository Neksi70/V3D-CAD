package com.volme3d.v3dabos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.util.UUID

/**
 * Alle Abos liegen als abos.json im App-Speicher. Kein Server, kein Konto —
 * die App hat keine Internet-Berechtigung.
 */
object Store {
    private const val DATEI = "abos.json"
    private var geladen: MutableList<Abo>? = null

    fun alle(ctx: Context): MutableList<Abo> {
        geladen?.let { return it }
        val f = File(ctx.filesDir, DATEI)
        val liste = if (f.exists()) runCatching { lies(f.readText()) }.getOrElse { ArrayList() }
                    else ArrayList()
        geladen = liste
        return liste
    }

    fun speichere(ctx: Context) {
        val liste = geladen ?: return
        File(ctx.filesDir, DATEI).writeText(schreibe(liste))
    }

    fun neu(): Abo = Abo(id = UUID.randomUUID().toString(), name = "")

    fun ersetze(ctx: Context, abo: Abo) {
        val liste = alle(ctx)
        val i = liste.indexOfFirst { it.id == abo.id }
        if (i >= 0) liste[i] = abo else liste.add(abo)
        speichere(ctx)
    }

    fun loesche(ctx: Context, id: String) {
        alle(ctx).removeAll { it.id == id }
        speichere(ctx)
    }

    fun finde(ctx: Context, id: String?): Abo? = id?.let { i -> alle(ctx).firstOrNull { it.id == i } }

    /** Verwirft den Cache — nach einem Import von außen. */
    fun neuLaden() { geladen = null }

    // --- JSON ---

    fun schreibe(liste: List<Abo>): String {
        val arr = JSONArray()
        for (a in liste) {
            val o = JSONObject()
            o.put("id", a.id); o.put("name", a.name); o.put("anbieter", a.anbieter)
            o.put("betragCent", a.betragCent); o.put("intervall", a.intervall.name)
            o.put("naechsteZahlung", a.naechsteZahlung?.toString() ?: JSONObject.NULL)
            o.put("vertragsbeginn", a.vertragsbeginn?.toString() ?: JSONObject.NULL)
            o.put("fristTage", a.fristTage); o.put("mindestlaufzeitMonate", a.mindestlaufzeitMonate)
            o.put("weg", a.weg.name); o.put("playPaket", a.playPaket); o.put("playSku", a.playSku)
            o.put("webUrl", a.webUrl); o.put("kuendigungEmail", a.kuendigungEmail)
            o.put("appPaket", a.appPaket); o.put("kundennummer", a.kundennummer)
            o.put("vertragsnummer", a.vertragsnummer); o.put("notiz", a.notiz)
            o.put("status", a.status.name)
            o.put("gekuendigtAm", a.gekuendigtAm?.toString() ?: JSONObject.NULL)
            o.put("endetAm", a.endetAm?.toString() ?: JSONObject.NULL)
            o.put("herkunft", a.herkunft)
            arr.put(o)
        }
        return JSONObject().put("version", 1).put("abos", arr).toString(2)
    }

    fun lies(text: String): MutableList<Abo> {
        val out = ArrayList<Abo>()
        val wurzel = JSONObject(text)
        val arr = wurzel.optJSONArray("abos") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                Abo(
                    id = o.optString("id", UUID.randomUUID().toString()),
                    name = o.optString("name"),
                    anbieter = o.optString("anbieter"),
                    betragCent = o.optLong("betragCent"),
                    intervall = enumOrDefault(o.optString("intervall"), Intervall.MONATLICH),
                    naechsteZahlung = datum(o, "naechsteZahlung"),
                    vertragsbeginn = datum(o, "vertragsbeginn"),
                    fristTage = o.optInt("fristTage"),
                    mindestlaufzeitMonate = o.optInt("mindestlaufzeitMonate"),
                    weg = enumOrDefault(o.optString("weg"), Weg.UNBEKANNT),
                    playPaket = o.optString("playPaket"),
                    playSku = o.optString("playSku"),
                    webUrl = o.optString("webUrl"),
                    kuendigungEmail = o.optString("kuendigungEmail"),
                    appPaket = o.optString("appPaket"),
                    kundennummer = o.optString("kundennummer"),
                    vertragsnummer = o.optString("vertragsnummer"),
                    notiz = o.optString("notiz"),
                    status = enumOrDefault(o.optString("status"), Status.AKTIV),
                    gekuendigtAm = datum(o, "gekuendigtAm"),
                    endetAm = datum(o, "endetAm"),
                    herkunft = o.optString("herkunft")
                )
            )
        }
        return out
    }

    private inline fun <reified T : Enum<T>> enumOrDefault(s: String, d: T): T =
        runCatching { enumValueOf<T>(s) }.getOrDefault(d)

    private fun datum(o: JSONObject, key: String): LocalDate? {
        val s = o.optString(key)
        if (s.isNullOrBlank() || s == "null") return null
        return runCatching { LocalDate.parse(s) }.getOrNull()
    }

    // --- Absender fürs Kündigungsschreiben ---

    fun absender(ctx: Context): Absender {
        val p = ctx.getSharedPreferences("v3dabos", Context.MODE_PRIVATE)
        return Absender(
            p.getString("abs_name", "") ?: "",
            p.getString("abs_strasse", "") ?: "",
            p.getString("abs_ort", "") ?: "",
            p.getString("abs_email", "") ?: ""
        )
    }

    fun setzeAbsender(ctx: Context, a: Absender) {
        ctx.getSharedPreferences("v3dabos", Context.MODE_PRIVATE).edit()
            .putString("abs_name", a.name).putString("abs_strasse", a.strasse)
            .putString("abs_ort", a.ort).putString("abs_email", a.email).apply()
    }

    fun vorwarnTage(ctx: Context): Int =
        ctx.getSharedPreferences("v3dabos", Context.MODE_PRIVATE).getInt("vorwarn", 14)

    fun setzeVorwarnTage(ctx: Context, tage: Int) {
        ctx.getSharedPreferences("v3dabos", Context.MODE_PRIVATE).edit().putInt("vorwarn", tage).apply()
    }
}
