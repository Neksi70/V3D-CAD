package com.volme3d.v3dabos

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class BewerterTest {

    private val heute = LocalDate.of(2026, 9, 13)

    private fun abo(cent: Long = 1399, iv: Intervall = Intervall.MONATLICH, paket: String = "com.x") =
        Abo(id = "1", name = "Test", betragCent = cent, intervall = iv, appPaket = paket)

    @Test
    fun monatsUndJahresbetrag() {
        assertEquals(1399, abo().monatsCent)
        assertEquals(16788, abo().jahresCent)
        val jahr = abo(5999, Intervall.JAEHRLICH)
        assertEquals(500, jahr.monatsCent)
        assertEquals(5999, jahr.jahresCent)
        val quartal = abo(3000, Intervall.VIERTELJAEHRLICH)
        assertEquals(1000, quartal.monatsCent)
        assertEquals(12000, quartal.jahresCent)
    }

    @Test
    fun ungenutztesAboWirdRot() {
        val n = Nutzung("com.x", heute.minusDays(45), 0, 12)
        val b = Bewerter.bewerte(abo(), n, heute)
        assertEquals(Ampel.ROT, b.ampel)
        assertTrue(b.grund.contains("45"))
    }

    @Test
    fun taeglichGenutztesAboWirdGruen() {
        val n = Nutzung("com.x", heute.minusDays(1), 900, 2700)
        val b = Bewerter.bewerte(abo(), n, heute)
        assertEquals(Ampel.GRUEN, b.ampel)
        // 13,99 EUR / 15 Std = 93 Cent je Stunde
        assertEquals(93L, b.centProStunde)
    }

    @Test
    fun kaumGenutztWirdGelb() {
        val n = Nutzung("com.x", heute.minusDays(2), 20, 60)
        assertEquals(Ampel.GELB, Bewerter.bewerte(abo(), n, heute).ampel)
    }

    @Test
    fun ohneAppKeineRoteKarte() {
        val b = Bewerter.bewerte(abo(paket = ""), null, heute)
        assertEquals(Ampel.GELB, b.ampel)
        assertNull(b.centProStunde)
    }

    @Test
    fun gekuendigtesAboIstGrauUndZaehltNichtMehr() {
        val a = abo().apply { status = Status.GEKUENDIGT; endetAm = heute.plusDays(20) }
        val b = Bewerter.bewerte(a, Nutzung("com.x", heute, 900, 2700), heute)
        assertEquals(Ampel.GRAU, b.ampel)
        assertTrue(b.grund.contains("03.10.2026"))
    }

    @Test
    fun nieBenutztOhneDatumIstRot() {
        val b = Bewerter.bewerte(abo(), Nutzung("com.x", null, 0, 0), heute)
        assertEquals(Ampel.ROT, b.ampel)
    }

    @Test
    fun fristWirdVomZahltagRueckwaertsGerechnet() {
        val a = abo().apply {
            naechsteZahlung = LocalDate.of(2026, 12, 1)
            fristTage = 30
        }
        // 30 Tage Frist -> Kuendigung muss spaetestens am 31.10. raus
        assertEquals(LocalDate.of(2026, 10, 31), a.spaetesterKuendigungstag())
    }

    @Test
    fun ohneFristGiltDerTagVorDerAbbuchung() {
        val a = abo().apply { naechsteZahlung = LocalDate.of(2026, 12, 1) }
        assertEquals(LocalDate.of(2026, 11, 30), a.spaetesterKuendigungstag())
    }

    @Test
    fun karteileichenStehenObenInDerListe() {
        val tot = abo(500)
        val teuerAktiv = abo(9900)
        val rTot = Bewerter.rang(tot, Bewertung(Ampel.ROT, "", null))
        val rAktiv = Bewerter.rang(teuerAktiv, Bewertung(Ampel.GRUEN, "", null))
        assertTrue(rTot > rAktiv)
    }
}
