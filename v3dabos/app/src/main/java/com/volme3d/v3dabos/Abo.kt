package com.volme3d.v3dabos

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Wie oft abgebucht wird. */
enum class Intervall(val anzeige: String, val monate: Double) {
    WOECHENTLICH("wöchentlich", 12.0 / 52.0),
    MONATLICH("monatlich", 1.0),
    ZWEIMONATLICH("alle 2 Monate", 2.0),
    VIERTELJAEHRLICH("vierteljährlich", 3.0),
    HALBJAEHRLICH("halbjährlich", 6.0),
    JAEHRLICH("jährlich", 12.0);

    /** Tage bis zur nächsten Abbuchung, für die Fortschreibung des Zahltermins. */
    fun naechsterTermin(von: LocalDate): LocalDate = when (this) {
        WOECHENTLICH -> von.plusWeeks(1)
        MONATLICH -> von.plusMonths(1)
        ZWEIMONATLICH -> von.plusMonths(2)
        VIERTELJAEHRLICH -> von.plusMonths(3)
        HALBJAEHRLICH -> von.plusMonths(6)
        JAEHRLICH -> von.plusYears(1)
    }
}

/** Auf welchem Weg man dieses Abo loswird. */
enum class Weg(val anzeige: String) {
    PLAY("Google Play"),
    WEB("Website des Anbieters"),
    EMAIL("E-Mail / Brief"),
    UNBEKANNT("noch unbekannt")
}

enum class Status { AKTIV, GEKUENDIGT, BEENDET }

/**
 * Ein kostenpflichtiges Abo.
 * [betragCent] ist der Betrag je [intervall], nicht der Monatspreis.
 */
data class Abo(
    val id: String,
    var name: String,
    var anbieter: String = "",
    var betragCent: Long = 0,
    var intervall: Intervall = Intervall.MONATLICH,
    var naechsteZahlung: LocalDate? = null,
    var vertragsbeginn: LocalDate? = null,
    /** Kündigungsfrist in Tagen vor dem Laufzeitende (0 = jederzeit kündbar). */
    var fristTage: Int = 0,
    var mindestlaufzeitMonate: Int = 0,
    var weg: Weg = Weg.UNBEKANNT,
    /** Paketname für den Play-Deep-Link (z. B. com.spotify.music). */
    var playPaket: String = "",
    /** Produkt-/SKU-Kennung, falls bekannt — springt im Play-Store direkt auf das Abo. */
    var playSku: String = "",
    var webUrl: String = "",
    var kuendigungEmail: String = "",
    /** App, deren Benutzung gemessen wird. Leer = keine App (z. B. Zeitung, Fitnessstudio). */
    var appPaket: String = "",
    var kundennummer: String = "",
    var vertragsnummer: String = "",
    var notiz: String = "",
    var status: Status = Status.AKTIV,
    var gekuendigtAm: LocalDate? = null,
    var endetAm: LocalDate? = null,
    /** Woher das Abo kam — nur zur Anzeige ("erkannt aus Kontoauszug" o. ä.). */
    var herkunft: String = ""
) {
    val monatsCent: Long get() = Math.round(betragCent / intervall.monate)
    val jahresCent: Long get() = Math.round(betragCent * (12.0 / intervall.monate))

    /**
     * Letzter Tag, an dem eine Kündigung zum nächsten Laufzeitende noch rechtzeitig ist.
     * Ohne Frist (jederzeit kündbar) ist das der Tag vor der nächsten Abbuchung.
     */
    fun spaetesterKuendigungstag(): LocalDate? {
        val ziel = naechsteZahlung ?: return null
        return ziel.minusDays((fristTage + 1).toLong())
    }
}

/** Ergebnis der Nutzungsmessung für eine App. */
data class Nutzung(
    val paket: String,
    /** Letzter Vordergrund-Start, null = im Messzeitraum nie benutzt. */
    val zuletzt: LocalDate?,
    val minuten30: Long,
    val minuten90: Long
)

enum class Ampel { GRUEN, GELB, ROT, GRAU }

/**
 * Empfehlung für ein Abo. [grund] ist der Satz, der in der Liste steht.
 */
data class Bewertung(
    val ampel: Ampel,
    val grund: String,
    /** Cent je Nutzungsstunde der letzten 30 Tage, null wenn nicht messbar. */
    val centProStunde: Long?
)

object Bewerter {
    /** Ab so vielen Tagen ohne Start gilt eine App als ungenutzt. */
    const val UNGENUTZT_TAGE = 30L

    fun bewerte(abo: Abo, n: Nutzung?, heute: LocalDate): Bewertung {
        if (abo.status != Status.AKTIV) {
            val bis = abo.endetAm?.let { " – läuft bis ${Fmt.datum(it)}" } ?: ""
            return Bewertung(Ampel.GRAU, "gekündigt$bis", null)
        }
        if (abo.appPaket.isBlank() || n == null) {
            return Bewertung(Ampel.GELB, "keine App verknüpft – Nutzung nicht messbar", null)
        }
        val cph = if (n.minuten30 > 0) Math.round(abo.monatsCent * 60.0 / n.minuten30) else null
        val tage = n.zuletzt?.let { ChronoUnit.DAYS.between(it, heute) }

        return when {
            tage == null ->
                Bewertung(Ampel.ROT, "seit mindestens 90 Tagen nicht benutzt", null)
            tage >= UNGENUTZT_TAGE ->
                Bewertung(Ampel.ROT, "seit $tage Tagen nicht benutzt", cph)
            n.minuten30 < 30 ->
                Bewertung(Ampel.GELB, "nur ${n.minuten30} Min. in 30 Tagen", cph)
            else -> {
                val std = n.minuten30 / 60
                Bewertung(Ampel.GRUEN, "${std} Std. ${n.minuten30 % 60} Min. in 30 Tagen", cph)
            }
        }
    }

    /** Sortierung der Liste: teuerste Karteileichen zuerst. */
    fun rang(abo: Abo, b: Bewertung): Long = when (b.ampel) {
        Ampel.ROT -> 3_000_000 + abo.monatsCent
        Ampel.GELB -> 2_000_000 + abo.monatsCent
        Ampel.GRUEN -> 1_000_000 + abo.monatsCent
        Ampel.GRAU -> abo.monatsCent
    }
}

object Fmt {
    /** Immer deutsches Format — unabhaengig davon, auf welche Sprache das Handy steht. */
    fun euro(cent: Long): String =
        String.format(java.util.Locale.GERMANY, "%,.2f €", cent / 100.0)

    /**
     * "12,99", "12.99" und "1.250,00" ergeben alle das Richtige: steht ein Komma im Text,
     * sind Punkte Tausendertrenner — sonst ist der Punkt das Dezimalzeichen.
     */
    fun euroZuCent(s: String): Long {
        var t = s.trim().replace("€", "").replace(" ", "").replace("\u00a0", "")
        t = if (t.contains(',')) t.replace(".", "").replace(',', '.') else t
        val d = t.toDoubleOrNull() ?: return 0
        return Math.round(d * 100)
    }

    fun datum(d: LocalDate): String =
        String.format(java.util.Locale.GERMANY, "%02d.%02d.%d", d.dayOfMonth, d.monthValue, d.year)
}
