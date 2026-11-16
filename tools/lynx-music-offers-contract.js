"use strict";

const { ACCOUNT, REGION } = require("./thn-production-certificate-release");
const hosts = Object.freeze([...require("../config/lynx-music-offer-hosts.json")]);

const distributionId = "FrontendDistributionLynxMusicOffers3ABF6E6E";
const viewerId = "FrontendViewerHostHeaderFunctionLynxMusicOffers7DA3093C";
const outputId = "FrontendDistributionDomainNameLynxMusicOffers";
const tlsDomain = "*.music.lynxpardelle.com";
const certificateArnPattern = new RegExp(`^arn:aws:acm:${REGION}:${ACCOUNT}:certificate/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`);

function staticPrefix(releaseId) {
  return `/frontend/angular-ssr/production/releases/${releaseId}/browser`;
}

function matchingStaticOrigin(config, releaseId, phase) {
  const staticOrigins = config?.Origins?.filter((origin) => origin.DomainName === "assets.zoolandingpage.com.mx");
  if (
    !["generated", "aliases"].includes(phase)
    || config?.Comment !== "Zoolandingpage Angular SSR frontend (production/lynx-music-offers)"
    || staticOrigins?.length !== 1
    || staticOrigins[0].OriginPath !== staticPrefix(releaseId)
  ) return undefined;
  if (phase === "generated" && (config.Aliases !== undefined || config.ViewerCertificate !== undefined)) return undefined;
  if (phase === "aliases" && (
    !Array.isArray(config.Aliases)
    || config.Aliases.length !== hosts.length
    || config.Aliases.some((host, index) => host !== hosts[index])
    || !certificateArnPattern.test(config.ViewerCertificate?.AcmCertificateArn || "")
  )) return undefined;
  return staticOrigins[0];
}

module.exports = { certificateArnPattern, distributionId, viewerId, hosts, matchingStaticOrigin, outputId, staticPrefix, tlsDomain };
