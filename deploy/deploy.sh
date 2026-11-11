#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
用途: 发布 kids-dictation-h5（静态站点，构建 dist 并发布到租户子域名 kids-dictation-h5.windory.xyz）

示例:
  bash deploy/deploy.sh
  bash deploy/deploy.sh --skip-build
  （服务器地址等共享参数由 miru_deploy/config.sh 定义）

参数:
  --tenant     子域名 / 站点目录（默认: kids-dictation-h5）
  --host       服务器地址（默认: 见 miru_deploy/config.sh）
  --user       SSH 用户（默认: root）
  --base-dir   共享运行时根目录（默认: /opt/miru）
  --version    发布版本（默认: 时间戳）
  --skip-build 跳过本地 build（使用现有 dist）
  --help       查看帮助

环境变量:
  MIRU_DEPLOY_HOME  共享部署配置目录（默认: 从项目目录逐级向上查找 miru_deploy，
                    找不到时使用 ../miru/miru_shared/miru_deploy）

前置条件:
  1. miru_deploy/runtime/tenants.conf 中已登记 kids-dictation-h5（website_type=static），
     并已执行过 miru_deploy/runtime/setup.sh 使配置生效。
  2. kids-dictation-h5.windory.xyz 的 DNS 已指向服务器（*.windory.xyz 通配记录已覆盖）。
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 未显式指定时，从项目目录逐级向上查找 miru_deploy，再回退到同级 miru 工作区
if [[ -z "${MIRU_DEPLOY_HOME:-}" ]]; then
  _dir="${PROJECT_DIR}"
  while [[ "${_dir}" != "/" ]]; do
    if [[ -f "${_dir}/miru_deploy/config.sh" ]]; then
      MIRU_DEPLOY_HOME="${_dir}/miru_deploy"
      break
    fi
    _dir="$(dirname "${_dir}")"
  done
  unset _dir
  _fallback="${PROJECT_DIR}/../miru/miru_shared/miru_deploy"
  if [[ -z "${MIRU_DEPLOY_HOME:-}" && -f "${_fallback}/config.sh" ]]; then
    MIRU_DEPLOY_HOME="$(cd "${_fallback}" && pwd)"
  fi
  unset _fallback
fi
if [[ ! -f "${MIRU_DEPLOY_HOME:-}/config.sh" ]]; then
  echo "未找到共享部署配置目录 miru_deploy"
  echo "请通过环境变量 MIRU_DEPLOY_HOME 指定其位置"
  exit 1
fi
source "${MIRU_DEPLOY_HOME}/config.sh"
source "${MIRU_DEPLOY_HOME}/lib/common.sh"

VERSION="$(date +%Y%m%d%H%M%S)"
SKIP_BUILD="false"
TENANT="kids-dictation-h5"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant) TENANT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --user) SSH_USER="$2"; shift 2 ;;
    --base-dir) BASE_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD="true"; shift 1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 1 ;;
  esac
done

REMOTE_RUNTIME_DIR="${BASE_DIR}/runtime"
REMOTE_SITES_ROOT="${REMOTE_RUNTIME_DIR}/nginx/html"
REMOTE_SITE_DIR="${REMOTE_SITES_ROOT}/${TENANT}/website/current"
REMOTE_SITE_BACKUP_DIR="${REMOTE_SITES_ROOT}/${TENANT}/website/backup"
ARCHIVE_NAME="kids-dictation-h5-${TENANT}-${VERSION}.tar.gz"
REMOTE_ARCHIVE="${REMOTE_RUNTIME_DIR}/${ARCHIVE_NAME}"
LOCAL_ARCHIVE="/tmp/${ARCHIVE_NAME}"

if [[ ! -f "${PROJECT_DIR}/package.json" ]]; then
  echo "未找到 kids-dictation-h5/package.json"
  exit 1
fi

if ! check_ssh; then
  echo "SSH 连接失败，请确认 ${SSH_USER}@${HOST} 免密可用，或稍后重试"
  exit 1
fi

if [[ "${SKIP_BUILD}" == "false" ]]; then
  echo "[1/4] 本地构建 kids-dictation-h5"
  (
    cd "${PROJECT_DIR}"
    echo "清理构建缓存..."
    rm -rf dist
    pnpm install --frozen-lockfile
    pnpm build
  )
else
  echo "[1/4] 跳过本地构建"
fi

if [[ ! -d "${PROJECT_DIR}/dist" ]]; then
  echo "未找到 dist 目录，请先执行构建"
  exit 1
fi

echo "[2/4] 打包 dist 内容"
TMP_STAGE="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_STAGE}" "${LOCAL_ARCHIVE}"
}
trap cleanup EXIT
mkdir -p "${TMP_STAGE}/site"
cp -R "${PROJECT_DIR}/dist/." "${TMP_STAGE}/site/"
find "${TMP_STAGE}" \( -name '._*' -o -name '.DS_Store' \) -delete

# COPYFILE_DISABLE 避免 macOS tar 写入 ._* 扩展属性文件
COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='.DS_Store' -czf "${LOCAL_ARCHIVE}" -C "${TMP_STAGE}" site

echo "[3/4] 上传并部署静态站点"
ssh "${SSH_USER}@${HOST}" "mkdir -p '${REMOTE_RUNTIME_DIR}' '${REMOTE_SITES_ROOT}/${TENANT}/website'"
upload_file "${LOCAL_ARCHIVE}" "${REMOTE_ARCHIVE}"
ssh "${SSH_USER}@${HOST}" "
set -euo pipefail
# 备份旧版本
if [ -d '${REMOTE_SITE_DIR}' ] && find '${REMOTE_SITE_DIR}' -mindepth 1 -maxdepth 1 | grep -q .; then
  rm -rf '${REMOTE_SITE_BACKUP_DIR}'
  mv '${REMOTE_SITE_DIR}' '${REMOTE_SITE_BACKUP_DIR}' || true
fi
# 解压到临时目录
TEMP_DIR='${REMOTE_SITES_ROOT}/${TENANT}/website/temp'
rm -rf \"\${TEMP_DIR}\"
mkdir -p \"\${TEMP_DIR}\"
tar --warning=no-unknown-keyword -xzf '${REMOTE_ARCHIVE}' -C \"\${TEMP_DIR}\"
# 移动到最终位置（解压后是 site 目录）
mv \"\${TEMP_DIR}/site\" '${REMOTE_SITE_DIR}'
rm -rf \"\${TEMP_DIR}\"
rm -f '${REMOTE_ARCHIVE}'
find '${REMOTE_SITE_DIR}' \( -name '._*' -o -name '.DS_Store' \) -delete || true
"

if ssh "${SSH_USER}@${HOST}" "test -f '${REMOTE_SITE_DIR}/index.html'"; then
  echo "[4/4] 静态站点已就绪: https://${TENANT}.${DOMAIN}/"
else
  echo "站点部署失败：未找到 index.html"
  exit 1
fi

echo "发布完成: kids-dictation-h5 ${VERSION} -> ${TENANT}.${DOMAIN}"
