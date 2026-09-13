package com.volme3d.v3dabos

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class KontoParserTest {

    /** Sparkassen-CSV: Semikolon, deutsche Beträge, Ausgaben negativ. */
    private val csvSparkasse = """
        "Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Betrag";"Waehrung"
        "DE12";"05.03.2026";"05.03.2026";"FOLGELASTSCHRIFT";"SPOTIFY AB Premium Family Ref. 1234";"-17,99";"EUR"
        "DE12";"05.02.2026";"05.02.2026";"FOLGELASTSCHRIFT";"SPOTIFY AB Premium Family Ref. 1198";"-17,99";"EUR"
        "DE12";"05.01.2026";"05.01.2026";"FOLGELASTSCHRIFT";"SPOTIFY AB Premium Family Ref. 1150";"-17,99";"EUR"
        "DE12";"12.03.2026";"12.03.2026";"LASTSCHRIFT";"NETFLIX INTERNATIONAL B.V.";"-13,99";"EUR"
        "DE12";"12.02.2026";"12.02.2026";"LASTSCHRIFT";"NETFLIX INTERNATIONAL B.V.";"-13,99";"EUR"
        "DE12";"01.03.2026";"01.03.2026";"GUTSCHRIFT";"GEHALT ARBEITGEBER GMBH";"2.850,00";"EUR"
        "DE12";"08.03.2026";"08.03.2026";"KARTENZAHLUNG";"REWE MARKT HAGEN";"-42,17";"EUR"
    """.trimIndent()

    @Test
    fun liestBuchungenAusCsv() {
        val b = KontoParser.buchungen(csvSparkasse)
        // Nur Ausgaben, die Gehaltsgutschrift faellt raus
        assertEquals(6, b.size)
        assertTrue(b.all { it.cent > 0 })
        assertEquals(LocalDate.of(2026, 3, 5), b[0].datum)
        assertEquals(1799L, b[0].cent)
        assertTrue(b[0].text.contains("SPOTIFY"))
    }

    @Test
    fun findetWiederkehrendeAbbuchungen() {
        val funde = KontoParser.findeAbos(KontoParser.buchungen(csvSparkasse))
        val namen = funde.map { it.name }
        assertTrue("Spotify fehlt: $namen", namen.contains("Spotify"))
        assertTrue("Netflix fehlt: $namen", namen.contains("Netflix"))
        // Einmalige Karteizahlung beim Supermarkt ist kein Abo
        assertFalse(namen.any { it.contains("Rewe", true) })

        val spotify = funde.first { it.name == "Spotify" }
        assertEquals(1799L, spotify.cent)                       // Betrag der letzten Buchung
        assertEquals(Intervall.MONATLICH, spotify.intervall)
        assertEquals(LocalDate.of(2026, 3, 5), spotify.letzte)
        assertEquals(LocalDate.of(2026, 4, 5), spotify.naechste)
        assertFalse(spotify.unsicher)
    }

    @Test
    fun referenznummernSprengenDieGruppeNicht() {
        // Die drei Spotify-Zeilen haben verschiedene Ref-Nummern und muessen trotzdem
        // in einer Gruppe landen.
        val spotify = KontoParser.findeAbos(KontoParser.buchungen(csvSparkasse))
            .first { it.name == "Spotify" }
        assertEquals(3, spotify.buchungen.size)
    }

    @Test
    fun erkenntEnglischesFormatUndIsoDatum() {
        val text = """
            2026-01-15,-9.99,ADOBE SYSTEMS SOFTWARE
            2026-02-15,-9.99,ADOBE SYSTEMS SOFTWARE
            2026-03-15,-9.99,ADOBE SYSTEMS SOFTWARE
        """.trimIndent()
        val b = KontoParser.buchungen(text)
        assertEquals(3, b.size)
        assertEquals(999L, b[0].cent)
        assertEquals(LocalDate.of(2026, 1, 15), b[0].datum)
        val f = KontoParser.findeAbos(b)
        assertEquals(1, f.size)
        assertEquals(Intervall.MONATLICH, f[0].intervall)
    }

    @Test
    fun ohneVorzeichenGiltJedeZeile() {
        // Aus der Banking-App kopierte Liste: keine Minuszeichen vorhanden
        val text = """
            01.03.2026 DAZN Limited 24,99
            01.02.2026 DAZN Limited 24,99
        """.trimIndent()
        val f = KontoParser.findeAbos(KontoParser.buchungen(text))
        assertEquals(1, f.size)
        assertEquals("DAZN", f[0].name)
        assertEquals(2499L, f[0].cent)
    }

    @Test
    fun jahresabosWerdenAlsSolcheErkannt() {
        val text = """
            -14.03.2025 KOMOOT GMBH Premium 59,99-
            14.03.2026 KOMOOT GMBH Premium 59,99-
        """.trimIndent()
        val f = KontoParser.findeAbos(KontoParser.buchungen(text))
        assertEquals(1, f.size)
        assertEquals(Intervall.JAEHRLICH, f[0].intervall)
        assertEquals(LocalDate.of(2027, 3, 14), f[0].naechste)
    }

    @Test
    fun einzelneBuchungNurBeiBekanntemDienst() {
        val text = """
            03.03.2026 NETFLIX INTERNATIONAL 13,99-
            03.03.2026 BAECKEREI SCHMITZ 4,20-
        """.trimIndent()
        val f = KontoParser.findeAbos(KontoParser.buchungen(text))
        assertEquals(1, f.size)
        assertEquals("Netflix", f[0].name)
        assertTrue(f[0].unsicher)
    }

    @Test
    fun tausendertrennerVerfaelschtDenBetragNicht() {
        val b = KontoParser.buchungen("01.03.2026 MIETE HAUSVERWALTUNG -1.250,00")
        assertEquals(125000L, b[0].cent)
    }

    @Test
    fun intervallAusAbstaenden() {
        val d = LocalDate.of(2026, 1, 1)
        assertEquals(Intervall.MONATLICH,
            KontoParser.intervallAus(listOf(d, d.plusMonths(1), d.plusMonths(2))))
        assertEquals(Intervall.VIERTELJAEHRLICH,
            KontoParser.intervallAus(listOf(d, d.plusMonths(3), d.plusMonths(6))))
        assertEquals(Intervall.WOECHENTLICH,
            KontoParser.intervallAus(listOf(d, d.plusWeeks(1), d.plusWeeks(2))))
    }

    @Test
    fun katalogTrifftDenLaengerenNamen() {
        // "amazon music" darf nicht von "amazon prime" geschluckt werden
        assertEquals("Amazon Music Unlimited",
            Katalog.zuBuchungstext("AMAZON MUSIC EU SARL")?.name)
        assertEquals("Amazon Prime", Katalog.zuBuchungstext("AMAZON PRIME DE")?.name)
    }
}
