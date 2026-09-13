package com.volme3d.v3dabos

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class KuendigungTest {

    private val heute = LocalDate.of(2026, 9, 13)
    private val absender = Absender("Volker Isken", "Musterweg 1", "58095 Hagen", "v@example.de")

    private fun abo() = Abo(
        id = "1", name = "DAZN", anbieter = "DAZN Limited",
        betragCent = 2499, kundennummer = "4711"
    )

    @Test
    fun schreibenEnthaeltAllesWesentliche() {
        val t = Kuendigung.text(abo(), absender, heute)
        assertTrue(t.contains("Volker Isken"))
        assertTrue(t.contains("58095 Hagen"))
        assertTrue(t.contains("DAZN Limited"))
        assertTrue(t.contains("13.09.2026"))
        assertTrue(t.contains("Kundennummer: 4711"))
        assertTrue(t.contains("nächstmöglichen Zeitpunkt"))
        assertTrue(t.contains("stillschweigenden Verlängerung"))
        assertTrue(t.contains("Textform"))
    }

    @Test
    fun schreibenFunktioniertAuchOhneAbsender() {
        val t = Kuendigung.text(abo(), Absender(), heute)
        assertFalse(t.contains("null"))
        assertTrue(t.startsWith("An: DAZN Limited"))
    }

    @Test
    fun betreffNenntDieVertragsnummern() {
        val a = abo().apply { vertragsnummer = "V-9" }
        assertEquals("Kündigung DAZN – Kundennummer 4711, Vertragsnummer V-9", Kuendigung.betreff(a))
    }

    @Test
    fun betreffOhneNummernBleibtSauber() {
        val a = abo().apply { kundennummer = "" }
        assertEquals("Kündigung DAZN", Kuendigung.betreff(a))
    }

    @Test
    fun playLinkZeigtAufDasEinzelneAbo() {
        val a = abo().apply { playPaket = "com.dazn"; playSku = "monthly" }
        assertEquals(
            "https://play.google.com/store/account/subscriptions?sku=monthly&package=com.dazn",
            Kuendigung.playUrl(a)
        )
    }

    @Test
    fun playLinkFaelltAufDieUebersichtZurueck() {
        assertEquals("https://play.google.com/store/account/subscriptions",
            Kuendigung.playUrl(abo()))
        val nurPaket = abo().apply { appPaket = "com.dazn" }
        assertTrue(Kuendigung.playUrl(nurPaket).endsWith("?package=com.dazn"))
    }

    @Test
    fun euroFormatIstDeutsch() {
        assertEquals("13,99 €", Fmt.euro(1399))
        assertEquals("0,50 €", Fmt.euro(50))
    }

    @Test
    fun betragsEingabeVerstehtBeideSchreibweisen() {
        assertEquals(1299L, Fmt.euroZuCent("12,99"))
        assertEquals(1299L, Fmt.euroZuCent("12.99"))
        assertEquals(125000L, Fmt.euroZuCent("1.250,00"))
        assertEquals(999L, Fmt.euroZuCent(" 9,99 € "))
        assertEquals(0L, Fmt.euroZuCent(""))
    }
}
