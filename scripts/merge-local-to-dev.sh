#!/bin/bash

# 检查当前分支是否为 local
current_branch=$(git branch --show-current)
if [ "$current_branch" != "local" ]; then
    echo "错误：当前不在 local 分支上"
    exit 1
fi

# 检查是否提供了提交信息参数
if [ "$1" = "-m" ] && [ ! -z "$2" ]; then
    commit_message="$2"
else
    commit_message="feat: merge local into dev"
fi

# 保存当前工作区
git stash

# 切换到 dev 分支并更新
git checkout dev
git pull origin dev

# 切回 local 分支
git checkout local

# 获取与 dev 分支的共同祖先提交
merge_base=$(git merge-base dev local)

# 将当前分支的所有改动压缩成一个提交
git reset --soft $merge_base
git commit -m "$commit_message"

# 切换到 dev 分支并合并
git checkout dev
git merge local

# 恢复之前保存的工作区
git stash pop

echo "已将 local 分支合并到 dev 分支"