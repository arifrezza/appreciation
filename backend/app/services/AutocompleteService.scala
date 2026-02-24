package services

import play.api.libs.ws._
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import play.api.libs.json._
import play.api.Logging

@Singleton
class AutocompleteService @Inject()(
	ws: WSClient
)(implicit ec: ExecutionContext) extends Logging {

	private val openAiUrl = "https://api.openai.com/v1/chat/completions"

	private val apiKey: String =
		sys.env.getOrElse(
			"OPENAI_API_KEY",
			throw new RuntimeException("OPENAI_API_KEY not set")
		)

	private val criteriaDefinitions: Map[String, String] = Map(
		"Be specific" -> "mention a concrete action, task, project, or achievement",
		"Highlight impact" -> "explain the effect on the team, project, or organization",
		"Acknowledge effort" -> "recognize dedication, perseverance, or hard work",
		"Reinforce consistency" -> "encourage continued behavior or express future confidence"
	)

	private def buildPrompt(failingCriteria: Seq[String], targetCriterion: Option[String]): String = {
		val base =
			"""You are an inline autocomplete engine AND spellchecker for employee appreciation messages in a corporate platform.
			  |You will receive the text the user has written so far.
			  |
			  |IMPORTANT: If the user's text contains abusive, offensive, inappropriate, or vulgar language, respond with EXACTLY: {"completion":"","corrections":[]}
			  |
			  |Return a JSON object with two fields:
			  |1. "completion": the remaining words to naturally finish the current sentence. Do NOT repeat any text the user has already written. Keep it concise — one sentence fragment, no more than 20 words.
			  |2. "corrections": an array of objects with "wrong" (misspelled word as it appears) and "fixed" (corrected word) for any misspelled words in the user's text.
			  |
			  |Rules for corrections:
			  |- Only flag genuinely misspelled words
			  |- Do NOT correct proper nouns, names, abbreviations, or acronyms
			  |- Do NOT correct informal but valid phrasing (e.g., "gonna", "wanna")
			  |- If no typos exist, return an empty array for corrections
			  |
			  |Return ONLY the raw JSON object. No markdown fencing, no explanation, no labels.""".stripMargin

		targetCriterion match {
			case Some(criterion) =>
				val definition = criteriaDefinitions.getOrElse(criterion, criterion)
				base +
					s"""
					   |
					   |The user has just used a phrase related to the criterion: "$criterion".
					   |Criterion definition: $definition
					   |
					   |Complete the sentence so that the criterion "$criterion" would clearly pass.""".stripMargin

			case None =>
				val criteriaList = failingCriteria.flatMap { name =>
					criteriaDefinitions.get(name).map(desc => s"- $name: $desc")
				}.mkString("\n")

				base +
					s"""
					   |
					   |The following quality criteria are NOT yet satisfied:
					   |$criteriaList
					   |
					   |Read the user's text and determine which of these failing criteria best fits what the user appears to be writing about. Complete the sentence to satisfy that criterion.""".stripMargin
		}
	}

	private def isRefusalResponse(text: String): Boolean = {
		val lower = text.toLowerCase
		lower.startsWith("i'm sorry") ||
			lower.startsWith("i cannot") ||
			lower.startsWith("i can't") ||
			lower.startsWith("sorry,") ||
			lower.startsWith("i apologize") ||
			lower.contains("cannot assist") ||
			lower.contains("can't assist") ||
			lower.contains("not appropriate") ||
			lower.contains("inappropriate language")
	}

	case class SpellCorrection(wrong: String, fixed: String)
	case class AutocompleteResult(completion: String, corrections: Seq[SpellCorrection])

	implicit val spellCorrectionReads: Reads[SpellCorrection] = Json.reads[SpellCorrection]
	implicit val spellCorrectionWrites: Writes[SpellCorrection] = Json.writes[SpellCorrection]

	private def parseAutocompleteResponse(raw: String): AutocompleteResult = {
		try {
			val json = Json.parse(raw)
			val completion = (json \ "completion").asOpt[String].getOrElse("").trim
			val corrections = (json \ "corrections").asOpt[Seq[SpellCorrection]].getOrElse(Seq.empty)
			AutocompleteResult(completion, corrections)
		} catch {
			case _: Exception =>
				// Fallback: treat entire response as plain-text completion (backwards compatible)
				AutocompleteResult(raw.trim, Seq.empty)
		}
	}

	def complete(text: String, failingCriteria: Seq[String], targetCriterion: Option[String]): Future[Either[String, AutocompleteResult]] = {

		val prompt = buildPrompt(failingCriteria, targetCriterion)

		val body = Json.obj(
			"model" -> "gpt-4o-mini",
			"messages" -> Json.arr(
				Json.obj("role" -> "system", "content" -> prompt),
				Json.obj("role" -> "user", "content" -> text)
			),
			"temperature" -> 0.3,
			"max_tokens" -> 120
		)

		ws.url(openAiUrl)
			.addHttpHeaders(
				"Authorization" -> s"Bearer $apiKey",
				"Content-Type" -> "application/json"
			)
			.post(body)
			.map { response =>
				if (response.status == 200) {
					val content =
						(response.json \ "choices")(0) \ "message" \ "content"

					content.asOpt[String].map(_.trim) match {
						case Some(raw) if isRefusalResponse(raw) =>
							Right(AutocompleteResult("", Seq.empty))
						case Some(raw) =>
							Right(parseAutocompleteResponse(raw))
						case None => Left("No completion returned")
					}
				} else {
					logger.error(s"Autocomplete API error: ${response.status}")
					Left("OpenAI API failed")
				}
			}
			.recover {
				case ex =>
					logger.error("Autocomplete failed", ex)
					Left(ex.getMessage)
			}
	}
}
