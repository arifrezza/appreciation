package services

import play.api.libs.ws._
import javax.inject._
import scala.concurrent.ExecutionContext
import play.api.Logging
import play.api.libs.json._
import scala.concurrent.Future

case class CriterionResult(score: Int, pass: Boolean)
object CriterionResult {
  implicit val format: Format[CriterionResult] = Json.format[CriterionResult]
}

case class QualityResult(
  beSpecific: CriterionResult,
  highlightImpact: CriterionResult,
  acknowledgeEffort: CriterionResult,
  reinforceConsistency: CriterionResult,
  overallScore: Int,
  guidanceType: String,
  guidance: String
)
object QualityResult {
  implicit val format: Format[QualityResult] = Json.format[QualityResult]
}

@Singleton
class AppreciationQualityService @Inject()(
  ws: WSClient
)(implicit ec: ExecutionContext) extends Logging {

  private val openAiUrl = "https://api.openai.com/v1/chat/completions"
  private val apiKey: String =
    sys.env.getOrElse(
      "OPENAI_API_KEY",
      throw new RuntimeException("OPENAI_API_KEY environment variable not set")
    )

  private val systemPrompt: String =
    """You are an appreciation writing coach for a corporate employee recognition platform. Your tone must be professional and formal at all times.

You will receive an appreciation message written by one employee about a colleague. Analyze it against four criteria and return a JSON evaluation.

## Scoring Rules

Score each criterion from 0 to 100. A criterion passes if its score is >= 50.

1. beSpecific: Does the message mention a concrete action, task, project, or achievement? Vague praise like "great job" or "you are amazing" scores 0-20. Naming a specific deliverable, event, or task scores 50+.

2. highlightImpact: Does the message explain the effect on the team, project, timeline, or organization? Simply stating what someone did without explaining why it mattered scores 0-20. Describing a consequence or outcome scores 50+.

3. acknowledgeEffort: Does the message recognize the effort, dedication, perseverance, or hard work involved? A bare "thank you" without acknowledging difficulty or commitment scores 0-20. Referencing the person's dedication, extra hours, or determination scores 50+.

4. reinforceConsistency: Does the message encourage continued behavior or express confidence in future contributions? No forward-looking element scores 0-20. Phrases that look ahead or encourage repetition score 50+.

## Overall Score

overallScore = average of the four criterion scores, rounded to the nearest integer.

## Guidance Rules

Count how many criteria pass (score >= 50). Use that count to decide the guidance type.

Analyze the original message carefully before generating guidance. Your guidance must directly reference the content of the message.

### If fewer than 2 criteria pass (guidanceType: "question")

Identify the SINGLE weakest criterion (lowest score). Provide exactly ONE coaching tip that:
- References what the user actually wrote
- Asks a specific question to draw out the missing element
- Ends with four suggested words or phrases

Format: "[Question referencing their message that targets the weak criterion] Consider phrases such as: [phrase1], [phrase2], [phrase3], [phrase4]"

IMPORTANT: Generate ONLY ONE tip for ONE criterion. Never combine tips. Keep the tip SHORT — max 15 words before "Consider phrases such as:".

### If 2 or more criteria pass but NOT all 4 (guidanceType: "suggestion")

Identify the SINGLE weakest failing criterion (lowest score among the ones that did NOT pass). Provide exactly ONE coaching tip that:
- References what the user actually wrote
- Asks a specific question or gives a specific suggestion to draw out the missing element
- Ends with four suggested words or phrases

Format: "[Tip referencing their message that targets the weakest failing criterion] Consider phrases such as: [phrase1], [phrase2], [phrase3], [phrase4]"

IMPORTANT: Generate ONLY ONE tip for ONE criterion. Never combine tips. Do NOT rewrite the full message here — that is handled separately. Keep the tip SHORT — max 15 words before "Consider phrases such as:".

### If all 4 criteria pass (guidanceType: "none")

Set guidanceType to "none" and guidance to an empty string. The frontend will handle the congratulation message.


### If fewer than 3 criteria pass AND overallScore < 50 (guidanceType: "question")

Identify the SINGLE weakest criterion (lowest score). Provide exactly ONE coaching tip that:
- References what the user actually wrote
- Asks a specific question to draw out the missing element
- Ends with four suggested words or phrases

Format: "[Question referencing their message that targets the weak criterion] Consider phrases such as: [phrase1], [phrase2], [phrase3], [phrase4]"

IMPORTANT: Generate ONLY ONE tip for ONE criterion. Never combine tips. Keep the tip SHORT — max 15 words before "Consider phrases such as:".

## Response Format

Respond with ONLY this JSON object. No markdown fencing, no explanation, no text outside the JSON.

{"beSpecific":{"score":0,"pass":false},"highlightImpact":{"score":0,"pass":false},"acknowledgeEffort":{"score":0,"pass":false},"reinforceConsistency":{"score":0,"pass":false},"overallScore":0,"guidanceType":"question","guidance":""}"""

  def checkQuality(text: String): Future[Either[String, QualityResult]] = {
    logger.info("Calling OpenAI Chat API for quality check")

    val requestBody = Json.obj(
      "model" -> "gpt-4o-mini",
      "messages" -> Json.arr(
        Json.obj(
          "role" -> "system",
          "content" -> systemPrompt
        ),
        Json.obj(
          "role" -> "user",
          "content" -> s"Analyze this appreciation message:\n\n$text"
        )
      ),
      "temperature" -> 0.2,
      "max_tokens" -> 600,
      "response_format" -> Json.obj("type" -> "json_object")
    )

    ws.url(openAiUrl)
      .addHttpHeaders(
        "Authorization" -> s"Bearer $apiKey",
        "Content-Type" -> "application/json"
      )
      .post(requestBody)
      .map { response =>
        //logger.debug(s"OpenAI response status: ${response.status}")
        
        if (response.status == 200) {
          val json = response.json
          val content = (json \ "choices")(0) \ "message" \ "content"
          
          content.asOpt[String] match {
            case Some(jsonStr) =>
              // Clean up potential markdown formatting
              val cleanJson = jsonStr
                .replaceAll("```json\\s*", "")
                .replaceAll("```\\s*", "")
                .trim
              
              Json.parse(cleanJson).validate[QualityResult] match {
                case JsSuccess(result, _) => 
                  logger.info(s"Quality check complete: score=${result.overallScore}, type=${result.guidanceType}")
                  Right(result)
                case JsError(errors) => 
                  logger.error(s"JSON parse error: $errors")
                  Left(s"Failed to parse AI response: $errors")
              }
            case None => 
              Left("No content in AI response")
          }
        } else {
          logger.error(s"OpenAI API error: ${response.status} - ${response.body}")
          Left(s"OpenAI API error: ${response.status}")
        }
      }
      .recover {
        case ex: Exception =>
          logger.error("OpenAI API call failed", ex)
          Left(s"API call failed: ${ex.getMessage}")
      }
  }
}
