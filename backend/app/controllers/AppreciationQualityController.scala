package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import scala.concurrent.ExecutionContext
import services.{AppreciationQualityService, CriterionResult, QualityResult}
import play.api.Logging

@Singleton
class AppreciationQualityController @Inject()(
  cc: ControllerComponents,
  qualityService: AppreciationQualityService
)(implicit ec: ExecutionContext)
  extends AbstractController(cc)
  with Logging {

  implicit val criterionWrites: Writes[CriterionResult] = Json.writes[CriterionResult]
  implicit val qualityWrites: Writes[QualityResult] = Json.writes[QualityResult]

  /**
   * POST /api/check-appreciation-quality
   * Body: { "text": "appreciation message" }
   * 
   * Returns quality scores for each criterion, overall score,
   * and AI coaching guidance (question or suggestion)
   */
  def checkQuality(): Action[JsValue] = Action.async(parse.json) { request =>
    val textOpt = (request.body \ "text").asOpt[String]

    textOpt match {
      case None =>
        logger.warn("Missing 'text' field in request")
        scala.concurrent.Future.successful(
          BadRequest(Json.obj(
            "success" -> false,
            "message" -> "Missing 'text' field"
          ))
        )

      case Some(text) if text.trim.isEmpty =>
        logger.warn("Empty text provided")
        scala.concurrent.Future.successful(
          BadRequest(Json.obj(
            "success" -> false,
            "message" -> "Text cannot be empty"
          ))
        )

      case Some(text) if text.trim.length < 2 =>
        logger.warn(s"Text too short: ${text.trim.length} characters")
        scala.concurrent.Future.successful(
          BadRequest(Json.obj(
            "success" -> false,
            "message" -> "Text must be at least 2 characters"
          ))
        )

      case Some(text) =>
        logger.info(s"Quality check requested for text of length ${text.length}")
        
        qualityService.checkQuality(text).map {
          case Right(result) =>
            Ok(Json.obj(
              "success" -> true,
              "quality" -> Json.obj(
                "beSpecific" -> Json.toJson(result.beSpecific),
                "highlightImpact" -> Json.toJson(result.highlightImpact),
                "acknowledgeEffort" -> Json.toJson(result.acknowledgeEffort),
                "reinforceConsistency" -> Json.toJson(result.reinforceConsistency)
              ),
              "overallScore" -> result.overallScore,
              "guidanceType" -> result.guidanceType,
              "guidance" -> result.guidance
            ))

          case Left(error) =>
            logger.error(s"Quality check failed: $error")
            InternalServerError(Json.obj(
              "success" -> false,
              "message" -> error
            ))
        }
    }
  }
}
