module.exports = (sequelize, DataTypes) => {
  const MessageReaction = sequelize.define(
    'MessageReaction',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      messageId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      emoji: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
    },
    {
      tableName: 'message_reactions',
      underscored: true,
      indexes: [
        { fields: ['message_id'] },
        { fields: ['user_id'] },
      ],
    },
  )

  return MessageReaction
}
