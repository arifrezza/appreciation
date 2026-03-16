package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import play.api.libs.ws._
import play.api.Configuration
import play.api.Logging
import akka.stream.scaladsl.{FileIO, Source}
import play.api.mvc.MultipartFormData.{DataPart, FilePart}
import akka.util.ByteString
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class TranscribeController @Inject()(
  cc: ControllerComponents,
  ws: WSClient,
  config: Configuration
)(implicit ec: ExecutionContext)
  extends AbstractController(cc)
  with Logging {

  private val whisperUrl = config.getOptional[String]("whisper.service.url")
    .getOrElse("http://localhost:8000")

  def transcribe(): Action[MultipartFormData[play.api.libs.Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { request =>

      request.body.file("audio") match {
        case None =>
          Future.successful(
            BadRequest(Json.obj("error" -> "Missing 'audio' file"))
          )

        case Some(audioPart) =>
          val fileSource = FileIO.fromPath(audioPart.ref.path)
          val contentType = audioPart.contentType.getOrElse("audio/webm")

          val multipartSource = Source(List(
            FilePart(
              "audio",
              audioPart.filename,
              Some(contentType),
              fileSource
            )
          ))

          ws.url(s"$whisperUrl/transcribe")
            .post(multipartSource)
            .map { response =>
              if (response.status == 200) {
                Ok(response.json)
              } else {
                logger.error(s"Whisper service error: ${response.status} ${response.body}")
                InternalServerError(Json.obj(
                  "error" -> "Transcription failed"
                ))
              }
            }
            .recover {
              case ex: Exception =>
                logger.error("Whisper service unavailable", ex)
                ServiceUnavailable(Json.obj(
                  "error" -> "Speech-to-text service is not available"
                ))
            }
      }
    }
}
