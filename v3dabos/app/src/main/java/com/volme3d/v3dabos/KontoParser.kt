package com.volme3d.v3dabos

import java.time.LocalDate
import kotlin.math.abs

data class Buchung(val datum: LocalDate, val cent: Long, val text: String)

/** Ein Verdacht auf ein Abo, aus wiederkehrenden Buchungen abgeleitet. */
data class Fund(
    val schluessel: String,
    val name: String,
    val cent: Long,
    val intervall: Intervall,
    val letzte: LocalDate,
    val buchungen: List<Buchung>,
    val katalog: KatalogEintrag?,
    /** true, wenn nur eine einzige Buchung vorliegt — Betrag/Intervall geraten. */
    val unsicher: Boolean
) {
    val naechste: LocalDate get() = intervall.naechsterTermin(letzte)
}

/**
 * Liest Kontoauszüge/Kreditkartenabrechnungen als CSV oder eingefügten Text und findet
 * wiederkehrende Abbuchungen. Bewusst formatblind: gesucht wird je Zeile ein Datum und
 * ein Betrag, der Rest ist Verwendungszweck. Das trägt CSV-Exporte der gängigen Banken
 * ebenso wie aus der Banking-App kopierte Umsatzlisten.
 */
object KontoParser {

    private val RE_DATUM_DE = Regex("""\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b""")
    private val RE_DATUM_ISO = Regex("""\b(\d{4})-(\d{2})-(\d{2})\b""")
    // 1.234,56 / 12,99 / -12,99 / 12,99-  — die Blicke nach vorn und hinten verhindern,
    // dass mitten aus einer laengeren Zahl ein Betrag herausgeschnitten wird.
    private val RE_BETRAG_DE =
        Regex("""(?<![\d.,])([-+]?)(\d{1,3}(?:[.  ]\d{3})*|\d+),(\d{2})(-?)(?![\d,])""")
    // 1,234.56 / 12.99 — nur genutzt, wenn keine DE-Beträge in der Datei stehen
    private val RE_BETRAG_EN =
        Regex("""(?<![\d.,])([-+]?)(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(-?)(?![\d.])""")

    private val STOPP = setOf(
        "sepa", "lastschrift", "basislastschrift", "folgelastschrift", "kartenzahlung",
        "dauerauftrag", "ueberweisung", "überweisung", "gutschrift", "belastung", "buchung",
        "verwendungszweck", "mandat", "mandatsreferenz", "glaeubiger", "gläubiger", "creditor",
        "ref", "referenz", "endtoend", "end", "eref", "kref", "mref", "cred", "svwz", "abwa",
        "iban", "bic", "wertstellung", "valuta", "umsatz", "rechnung", "rechnungsnr", "vertrag",
        "kundennummer", "kunden", "nummer", "der", "die", "das", "und", "von", "fuer",
        "für", "gmbh", "ltd", "inc", "kg", "sarl", "limited", "europe",
        "eur", "payment", "purchase", "monthly", "subscription", "abo"
    )

    /** Zerlegt den Text in Buchungen. Zeilen ohne Datum oder ohne Betrag werden übersprungen. */
    fun buchungen(roh: String): List<Buchung> {
        // Erst die Datumsangaben ausmaskieren: "05.03.2026" sieht sonst aus wie der englisch
        // geschriebene Betrag "05.03" und kippt die Erkennung des Zahlenformats.
        val zeilen = roh.split('\n').map { z ->
            val flach = z.replace('\t', ' ').replace(';', ' ').replace('"', ' ')
            flach to ohneDatum(flach)
        }

        val deutsch = zeilen.sumOf { RE_BETRAG_DE.findAll(it.second).count() } >=
                      zeilen.sumOf { RE_BETRAG_EN.findAll(it.second).count() }
        val re = if (deutsch) RE_BETRAG_DE else RE_BETRAG_EN
        // Stehen ueberhaupt Vorzeichen in der Datei? Dann sind Abos die negativen Zeilen.
        val hatMinus = zeilen.any { z -> re.findAll(z.second).any { istNegativ(it) } }

        val out = ArrayList<Buchung>()
        for ((flach, rest) in zeilen) {
            val datum = findeDatum(flach) ?: continue
            // Bei mehreren Betraegen (Umsatz + Saldo) ist der erste die Buchung.
            val m = re.find(rest) ?: continue
            if (hatMinus && !istNegativ(m)) continue
            val cent = centAus(m)
            if (cent <= 0) continue
            val text = saeubere(rest)
            if (text.isBlank()) continue
            out.add(Buchung(datum, cent, text))
        }
        return out
    }

    private fun ohneDatum(z: String): String {
        var t = z
        RE_DATUM_ISO.findAll(z).forEach { t = t.replace(it.value, " ") }
        RE_DATUM_DE.findAll(z).forEach { t = t.replace(it.value, " ") }
        return t
    }

    private fun istNegativ(m: MatchResult) = m.groupValues[1] == "-" || m.groupValues[4] == "-"

    private fun centAus(m: MatchResult): Long {
        val ganz = m.groupValues[2]
            .replace(".", "").replace(",", "").replace(" ", "").replace(" ", "")
        val nach = m.groupValues[3]
        return (ganz.toLongOrNull() ?: return 0) * 100 + nach.toLong()
    }

    private fun findeDatum(z: String): LocalDate? {
        RE_DATUM_ISO.find(z)?.let { m ->
            return runCatching {
                LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
            }.getOrNull()
        }
        RE_DATUM_DE.find(z)?.let { m ->
            var jahr = m.groupValues[3].toInt()
            if (jahr < 100) jahr += 2000
            return runCatching {
                LocalDate.of(jahr, m.groupValues[2].toInt(), m.groupValues[1].toInt())
            }.getOrNull()
        }
        return null
    }

    /** Buchungstext = die Zeile ohne Datum und ohne Betraege. */
    private fun saeubere(ohneDatum: String): String {
        var t = ohneDatum
        RE_BETRAG_DE.findAll(ohneDatum).forEach { t = t.replace(it.value, " ") }
        RE_BETRAG_EN.findAll(ohneDatum).forEach { t = t.replace(it.value, " ") }
        return t.replace(Regex("""[\s,;]+"""), " ").trim()
    }

    /** Normalisierter Gruppenschlüssel: nur die tragenden Wörter, ohne Referenznummern. */
    fun schluessel(text: String): String {
        val woerter = text.lowercase()
            .replace(Regex("""[^a-zäöüß ]"""), " ")   // Zeilen mit Ziffern -> Referenzen raus
            .split(' ')
            .filter { it.length >= 3 && it !in STOPP }
        return woerter.take(3).joinToString(" ")
    }

    /**
     * Gruppiert die Buchungen und liefert die Abo-Verdachtsfälle.
     * Eine Gruppe zählt als Abo, wenn sie mindestens zweimal vorkommt — oder einmal,
     * aber der Buchungstext einen bekannten Dienst nennt (dann [Fund.unsicher]).
     */
    fun findeAbos(buchungen: List<Buchung>): List<Fund> {
        val gruppen = HashMap<String, MutableList<Buchung>>()
        for (b in buchungen) {
            val kat = Katalog.zuBuchungstext(b.text)
            val key = kat?.name ?: schluessel(b.text)
            if (key.isBlank()) continue          // reine Zahlenzeile, kein Empfaenger erkennbar
            gruppen.getOrPut(key) { ArrayList() }.add(b)
        }

        val funde = ArrayList<Fund>()
        for ((key, liste) in gruppen) {
            val sortiert = liste.sortedBy { it.datum }
            val kat = Katalog.eintraege.firstOrNull { it.name == key }
                ?: Katalog.zuBuchungstext(sortiert.last().text)
            if (sortiert.size < 2 && kat == null) continue

            val letzte = sortiert.last()
            val intervall = if (sortiert.size >= 2)
                intervallAus(sortiert.map { it.datum })
            else kat!!.intervall

            funde.add(
                Fund(
                    schluessel = key,
                    name = kat?.name ?: hübsch(letzte.text),
                    cent = letzte.cent,
                    intervall = intervall,
                    letzte = letzte.datum,
                    buchungen = sortiert,
                    katalog = kat,
                    unsicher = sortiert.size < 2
                )
            )
        }
        // Teuerste zuerst — da lohnt das Aufräumen am meisten.
        return funde.sortedByDescending { Math.round(it.cent * 30.0 / (it.intervall.monate * 30.0)) }
    }

    /** Median der Abstände in Tagen auf ein Zahlungsintervall abbilden. */
    fun intervallAus(daten: List<LocalDate>): Intervall {
        val d = daten.sorted()
        val abstaende = d.zipWithNext { a, b -> java.time.temporal.ChronoUnit.DAYS.between(a, b) }
            .filter { it > 0 }.sorted()
        if (abstaende.isEmpty()) return Intervall.MONATLICH
        val median = abstaende[abstaende.size / 2]
        return when {
            median <= 10 -> Intervall.WOECHENTLICH
            median <= 45 -> Intervall.MONATLICH
            median <= 75 -> Intervall.ZWEIMONATLICH
            median <= 135 -> Intervall.VIERTELJAEHRLICH
            median <= 250 -> Intervall.HALBJAEHRLICH
            else -> Intervall.JAEHRLICH
        }
    }

    /** Aus "PAYPAL SPOTIFY AB" wird "Paypal Spotify Ab" — nur fürs Auge. */
    private fun hübsch(text: String): String =
        text.split(' ').filter { it.isNotBlank() }.take(4).joinToString(" ") { w ->
            if (w.length > 2 && w == w.uppercase())
                w.lowercase().replaceFirstChar { it.uppercase() }
            else w
        }

    /** Prüft, ob ein Fund schon als Abo erfasst ist (Name oder Paket gleich). */
    fun schonErfasst(fund: Fund, vorhanden: List<Abo>): Boolean = vorhanden.any { a ->
        a.name.equals(fund.name, true) ||
        (fund.katalog != null && fund.katalog.paket.isNotBlank() && a.appPaket == fund.katalog.paket)
    }

    fun abstandTage(a: LocalDate, b: LocalDate): Long = abs(java.time.temporal.ChronoUnit.DAYS.between(a, b))
}
