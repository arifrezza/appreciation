name := "appreciation-backend"

version := "1.0-SNAPSHOT"

lazy val root = (project in file(".")).enablePlugins(PlayScala)

scalaVersion := "2.13.14"

libraryDependencies ++= Seq(
  guice,
  jdbc,
  "com.typesafe.play" %% "play-json" % "2.9.4",
  "com.typesafe.play" %% "play-ahc-ws" % "2.9.4",
  "io.getquill" %% "quill-jdbc" % "4.8.0",
  "mysql" % "mysql-connector-java" % "8.0.33",
  "com.github.t3hnar" %% "scala-bcrypt" % "4.3.0",
  "org.scalatestplus.play" %% "scalatestplus-play" % "5.1.0" % Test
)

// Add CORS filter for development
libraryDependencies += filters
