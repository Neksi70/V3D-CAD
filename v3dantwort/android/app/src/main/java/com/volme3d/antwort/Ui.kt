package com.volme3d.antwort

import android.content.Context
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView

/** Kleine Bausteine für die Oberfläche (ohne XML-Layouts, ohne AppCompat). */
object Ui {
    const val GRUEN = 0xFF25D366.toInt()
    const val DUNKELGRUEN = 0xFF075E54.toInt()

    fun dunkel(c: Context) =
        (c.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun hinter(c: Context) = if (dunkel(c)) 0xFF0B141A.toInt() else 0xFFF0F2F5.toInt()
    fun karte(c: Context) = if (dunkel(c)) 0xFF202C33.toInt() else 0xFFFFFFFF.toInt()
    fun blase(c: Context) = if (dunkel(c)) 0xFF005C4B.toInt() else 0xFFD9FDD3.toInt()
    fun schrift(c: Context) = if (dunkel(c)) 0xFFE9EDEF.toInt() else 0xFF111B21.toInt()
    fun leise(c: Context) = if (dunkel(c)) 0xFF8696A0.toInt() else 0xFF667781.toInt()

    fun dp(c: Context, v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), c.resources.displayMetrics).toInt()

    fun rund(farbe: Int, radius: Float, rand: Int? = null) = GradientDrawable().apply {
        setColor(farbe); cornerRadius = radius
        if (rand != null) setStroke(2, rand)
    }

    fun spalte(c: Context) = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL }

    fun text(c: Context, t: String, groesse: Float = 15f, fett: Boolean = false, farbe: Int? = null) = TextView(c).apply {
        text = t
        textSize = groesse
        setTextColor(farbe ?: schrift(c))
        if (fett) setTypeface(typeface, Typeface.BOLD)
        setTextIsSelectable(true)
    }

    fun ueberschrift(c: Context, t: String) = text(c, t, 13f, true, leise(c)).apply {
        setPadding(dp(c, 4), dp(c, 16), 0, dp(c, 6))
        isAllCaps = true
    }

    fun knopf(c: Context, t: String, haupt: Boolean = false, klick: () -> Unit) = Button(c).apply {
        text = t
        isAllCaps = false
        textSize = 15f
        setTextColor(if (haupt) 0xFF0B141A.toInt() else schrift(c))
        background = rund(if (haupt) GRUEN else karte(c), dp(c, 22).toFloat(), if (haupt) null else leise(c))
        setPadding(dp(c, 16), 0, dp(c, 16), 0)
        minHeight = dp(c, 44)
        stateListAnimator = null
        setOnClickListener { klick() }
    }

    fun abstand(v: View, oben: Int = 0, rechts: Int = 0) {
        val lp = (v.layoutParams as? LinearLayout.LayoutParams)
            ?: LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.topMargin = Ui.dp(v.context, oben); lp.rightMargin = Ui.dp(v.context, rechts)
        v.layoutParams = lp
    }

    /** Waagerechte, wischbare Reihe von Knöpfen. */
    fun reihe(c: Context, vararg knoepfe: View): HorizontalScrollView {
        val r = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        knoepfe.forEach { r.addView(it); abstand(it, rechts = 8) }
        return HorizontalScrollView(c).apply { isHorizontalScrollBarEnabled = false; addView(r) }
    }
}
