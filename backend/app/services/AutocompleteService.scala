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
			  |   Use proper sentence punctuation. If the completion starts a new clause, prefer a period (.) over semicolons (;) or colons (:). Capitalize the first letter after any sentence-ending punctuation (. ! ?).
			  |   If the user's text does not end with sentence-ending punctuation (. ! ?), begin the completion in lowercase since it continues the existing sentence.
			  |2. "corrections": an array of objects with "wrong" (the incorrect word or phrase as it appears), "fixed" (the corrected version), and "type" ("spelling", "grammar", or "tone") for any spelling, grammar, or tone errors in the user's text.
			  |
			  |CRITICAL — Grammar & Spelling Check Instructions (do this FIRST, before writing the completion):
			  |Before generating the completion, carefully re-read the user's text word by word and check for ALL of the following:
			  |  a) Misspelled words → type: "spelling"
			  |  b) Missing auxiliary verbs (e.g., "you done" should be "you have done") → type: "grammar"
			  |  c) Subject-verb disagreement (e.g., "he work" should be "he works") → type: "grammar"
			  |  d) Wrong tense usage (e.g., "I seen" should be "I have seen", "she come yesterday" should be "she came yesterday") → type: "grammar"
			  |  e) Missing or wrong articles (e.g., "he is good person" should be "he is a good person") → type: "grammar"
			  |  f) Missing prepositions (e.g., "good working the project" should be "good working on the project", "help login module" should be "help with the login module") → type: "grammar"
			  |  g) Negative, harsh, or inappropriate tone for an appreciation message (e.g., "you finally managed to do something right", "despite your usual mistakes") → type: "tone". Suggest a rephrased version that conveys the same meaning in a positive, encouraging way.
			  |
			  |For grammar errors, "wrong" must be the minimal incorrect phrase from the user's text and "fixed" must be the corrected phrase.
			  |Examples:
			  |  - "You done a good job" → {"wrong": "You done", "fixed": "You have done", "type": "grammar"}
			  |  - "he work very hard" → {"wrong": "he work", "fixed": "he works", "type": "grammar"}
			  |  - "I seen your effort" → {"wrong": "I seen", "fixed": "I have seen", "type": "grammar"}
			  |  - "she definately helped" → {"wrong": "definately", "fixed": "definitely", "type": "spelling"}
			  |  - "help login module" → {"wrong": "help login module", "fixed": "help with the login module", "type": "grammar"}
			  |  - "Thank u" → {"wrong": "u", "fixed": "you", "type": "spelling"}
			  |  - "you finally managed to finish" → {"wrong": "you finally managed to finish", "fixed": "you successfully completed", "type": "tone"}
			  |
			  |You MUST report every error found. Do NOT skip grammar errors just because you understand the intended meaning.
			  |
			  |Rules for corrections:
			  |- Do NOT replace correctly-spelled words with synonyms, antonyms, or the same word. Do NOT change tone or sentiment (e.g., do NOT flag "poor", "bad", or any other valid English word)
			  |- Do NOT correct proper nouns, names, abbreviations, or acronyms
			  |- Do NOT correct informal but valid phrasing (e.g., "gonna", "wanna")
			  |- If no errors exist, return an empty array for corrections
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

	case class SpellCorrection(wrong: String, fixed: String, `type`: String = "spelling")
	case class AutocompleteResult(completion: String, corrections: Seq[SpellCorrection])

	implicit val spellCorrectionReads: Reads[SpellCorrection] = Json.reads[SpellCorrection]
	implicit val spellCorrectionWrites: Writes[SpellCorrection] = Json.writes[SpellCorrection]

	private def editDistance(a: String, b: String): Int = {
		val dp = Array.ofDim[Int](a.length + 1, b.length + 1)
		for (i <- 0 to a.length) dp(i)(0) = i
		for (j <- 0 to b.length) dp(0)(j) = j
		for (i <- 1 to a.length; j <- 1 to b.length) {
			val cost = if (a(i - 1) == b(j - 1)) 0 else 1
			dp(i)(j) = Math.min(Math.min(dp(i - 1)(j) + 1, dp(i)(j - 1) + 1), dp(i - 1)(j - 1) + cost)
		}
		dp(a.length)(b.length)
	}

	private def isPlausibleTypo(wrong: String, fixed: String): Boolean = {
		val w = wrong.toLowerCase
		val f = fixed.toLowerCase
		val dist = editDistance(w, f)
		val minLen = Math.min(w.length, f.length)
		val maxLen = Math.max(w.length, f.length)
		if (maxLen == 0) false
		else if (minLen <= 2) dist <= 2
		else dist.toDouble / maxLen <= 0.6
	}

	private val markdownFencePattern = """(?s)^```(?:json)?\s*\n?(.*?)\n?\s*```$""".r

	private def stripMarkdownFencing(raw: String): String = {
		raw.trim match {
			case markdownFencePattern(content) => content.trim
			case other => other
		}
	}

	private def parseAutocompleteResponse(raw: String): AutocompleteResult = {
		try {
			val cleaned = stripMarkdownFencing(raw)
			val json = Json.parse(cleaned)
			val completion = (json \ "completion").asOpt[String].getOrElse("").trim
			val corrections = (json \ "corrections").asOpt[Seq[SpellCorrection]].getOrElse(Seq.empty)
				.filter(c => c.`type` == "grammar" || c.`type` == "tone" || isPlausibleTypo(c.wrong, c.fixed))
			AutocompleteResult(completion, corrections)
		} catch {
			case _: Exception =>
				logger.warn(s"Failed to parse autocomplete response: ${raw.take(200)}")
				AutocompleteResult("", Seq.empty)
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
