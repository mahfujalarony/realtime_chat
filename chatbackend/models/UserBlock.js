module.exports = (sequelize, DataTypes) => {
  const UserBlock = sequelize.define(
    'UserBlock',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      blockerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      blockedUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'user_blocks',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['blocker_id', 'blocked_user_id'],
          name: 'user_blocks_blocker_id_blocked_user_id_unique',
        },
        {
          fields: ['blocked_user_id'],
          name: 'user_blocks_blocked_user_id_index',
        },
      ],
    },
  )

  return UserBlock
}
