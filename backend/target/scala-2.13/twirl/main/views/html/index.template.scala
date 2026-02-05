
package views.html

import _root_.play.twirl.api.TwirlFeatureImports._
import _root_.play.twirl.api.TwirlHelperImports._
import _root_.play.twirl.api.Html
import _root_.play.twirl.api.JavaScript
import _root_.play.twirl.api.Txt
import _root_.play.twirl.api.Xml
import models._
import controllers._
import play.api.i18n._
import views.html._
import play.api.templates.PlayMagic._
import play.api.mvc._
import play.api.data._

object index extends _root_.play.twirl.api.BaseScalaTemplate[play.twirl.api.HtmlFormat.Appendable,_root_.play.twirl.api.Format[play.twirl.api.HtmlFormat.Appendable]](play.twirl.api.HtmlFormat) with _root_.play.twirl.api.Template1[RequestHeader,play.twirl.api.HtmlFormat.Appendable] {

  /**/
  def apply/*1.2*/()(implicit request: RequestHeader):play.twirl.api.HtmlFormat.Appendable = {
    _display_ {
      {


Seq[Any](format.raw/*2.1*/("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Appreciation</title>
    <base href="/">
    
    """),format.raw/*10.78*/("""
    """),format.raw/*11.5*/("""<link rel="stylesheet" href='"""),_display_(/*11.35*/routes/*11.41*/.Assets.versioned("angular/styles.css")),format.raw/*11.80*/("""'>
</head>
<body>
    """),format.raw/*14.35*/("""
    """),format.raw/*15.5*/("""<app-root></app-root>
    
    """),format.raw/*17.34*/("""
    """),format.raw/*18.5*/("""<script src='"""),_display_(/*18.19*/routes/*18.25*/.Assets.versioned("angular/runtime.js")),format.raw/*18.64*/("""' type="module"></script>
    <script src='"""),_display_(/*19.19*/routes/*19.25*/.Assets.versioned("angular/polyfills.js")),format.raw/*19.66*/("""' type="module"></script>
    <script src='"""),_display_(/*20.19*/routes/*20.25*/.Assets.versioned("angular/main.js")),format.raw/*20.61*/("""' type="module"></script>
</body>
</html>
"""))
      }
    }
  }

  def render(request:RequestHeader): play.twirl.api.HtmlFormat.Appendable = apply()(request)

  def f:(() => (RequestHeader) => play.twirl.api.HtmlFormat.Appendable) = () => (request) => apply()(request)

  def ref: this.type = this

}


              /*
                  -- GENERATED --
                  SOURCE: app/views/index.scala.html
                  HASH: a4d410206b44200965478a4462ba03146aa5e257
                  MATRIX: 736->1|865->37|1099->316|1131->321|1188->351|1203->357|1263->396|1313->448|1345->453|1404->513|1436->518|1477->532|1492->538|1552->577|1623->621|1638->627|1700->668|1771->712|1786->718|1843->754
                  LINES: 21->1|26->2|34->10|35->11|35->11|35->11|35->11|38->14|39->15|41->17|42->18|42->18|42->18|42->18|43->19|43->19|43->19|44->20|44->20|44->20
                  -- GENERATED --
              */
          