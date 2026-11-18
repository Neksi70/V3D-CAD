package com.volme3d.antwort

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class Vorschlag(val antwort: String, val frei: List<String>, val hinweise: List<String>, val dauer: Double)

object Api {
    /** Blockiert – nur aus einem Hintergrund-Thread aufrufen. */
    fun vorschlag(
        c: Context, absender: String, text: String, verlauf: List<Nachricht>,
        termine: Boolean, wunsch: String = "", vorher: String = "",
    ): Vorschlag {
        val key = Speicher.key(c)
        if (key.isBlank()) throw Exception("Noch nicht eingerichtet – Einrichtungs-Link öffnen")
        val body = JSONObject()
            .put("absender", absender).put("text", text).put("termine", termine)
            .put("wunsch", wunsch).put("vorher", vorher)
            .put("verlauf", JSONArray().apply {
                verlauf.forEach { put(JSONObject().put("von", it.von ?: "Ich (Volker)").put("text", it.text)) }
            })
        val con = URL(Speicher.url(c).trimEnd('/') + "/api/vorschlag").openConnection() as HttpURLConnection
        con.requestMethod = "POST"
        con.connectTimeout = 15000
        con.readTimeout = 120000
        con.doOutput = true
        con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        con.setRequestProperty("X-Key", key)
        con.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = con.responseCode
        val roh = (if (code in 200..299) con.inputStream else con.errorStream)?.bufferedReader()?.readText() ?: ""
        val j = try { JSONObject(roh) } catch (e: Exception) { throw Exception("Server antwortet nicht richtig ($code)") }
        if (code !in 200..299) throw Exception(j.optString("fehler", "Fehler $code"))
        fun liste(name: String) = j.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        return Vorschlag(j.getString("antwort"), liste("frei"), liste("hinweise"), j.optDouble("dauer_s", 0.0))
    }
}
