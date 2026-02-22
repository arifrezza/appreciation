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
			"""You are an inline autocomplete engine for employee appreciation messages in a corporate platform.
			  |You will receive the text the user has written so far.
			  |Output ONLY the remaining words to naturally finish the current sentence.
			  |Do NOT repeat any text the user has already written.
			  |Keep it concise — one sentence fragment, no more than 20 words.
			  |Do NOT add quotes, explanations, or labels. Just the raw completion text.""".stripMargin

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

	def complete(text: String, failingCriteria: Seq[String], targetCriterion: Option[String]): Future[Either[String, String]] = {

		val prompt = buildPrompt(failingCriteria, targetCriterion)

		val body = Json.obj(
			"model" -> "gpt-4o-mini",
			"messages" -> Json.arr(
				Json.obj("role" -> "system", "content" -> prompt),
				Json.obj("role" -> "user", "content" -> text)
			),
			"temperature" -> 0.3,
			"max_tokens" -> 60
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

					content.asOpt[String] match {
						case Some(completion) => Right(completion.trim)
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
